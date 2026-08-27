import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type Command, type Projection } from "@koi/core";
import { EditorStore, KoiEditor } from "@koi/editor";
import {
  KOI_MCP_TOOL_NAMES,
  MAX_TOOL_DOCUMENT_BYTES,
  type SnapshotChunkRequest,
} from "@koi/mcp/protocol";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  readApplyAcknowledgement,
  readExport,
  readImportAcknowledgement,
  readProjection,
  readSnapshotTransfer,
  readToolFailure,
} from "./bridge.js";
import {
  acknowledgePendingCommand,
  ApplyRefreshCoordinator,
  callWithOneExactRetry,
  InteractionLockLease,
  readAmbiguousRetryFailure,
  reconcileCommittedProjectionResult,
} from "./commit-sync.js";
import { recoverRejectedCommand } from "./conflict-recovery.js";
import { loadInitialProjection, loadProjectionResult } from "./initial-load.js";
import { shouldInstallProjection } from "./projection-order.js";
import { SerialTaskQueue } from "./serial-task-queue.js";
import "@koi/editor/style.css";
import "./styles.css";

const TOOL_TIMEOUT_MS = 15_000;
const MAX_MODEL_CONTEXT_BYTES = 64_000;

function requestSnapshotChunk(
  app: App,
  request: SnapshotChunkRequest,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  return app.callServerTool(
    { name: KOI_MCP_TOOL_NAMES.readSnapshotChunk, arguments: { ...request } },
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TOOL_TIMEOUT_MS)])
        : AbortSignal.timeout(TOOL_TIMEOUT_MS),
    },
  );
}

function fileUri(filename: string): string {
  return `file:///${encodeURIComponent(filename)}`;
}

function modelContextForCommand(command: Command, revision: number) {
  const detailed = {
    event: "koi.command.committed",
    revision,
    command,
  };
  if (new TextEncoder().encode(JSON.stringify(detailed)).byteLength <= MAX_MODEL_CONTEXT_BYTES) {
    return detailed;
  }
  return {
    event: detailed.event,
    revision,
    commandId: command.commandId,
    documentId: command.documentId,
    elementIds: command.operations.map((operation) =>
      operation.type === "create" ? operation.element.id : operation.elementId,
    ),
    detailTruncated: true,
  };
}

function KoiMcpView() {
  const [store, setStore] = useState<EditorStore>();
  const [status, setStatus] = useState("Connecting…");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [initialLoadError, setInitialLoadError] = useState<{
    message: string;
    retryable: boolean;
  }>();
  const [hostContext, setHostContext] = useState<McpUiHostContext>();
  const appRef = useRef<App | null>(null);
  const storeRef = useRef<EditorStore | undefined>(undefined);
  const lastSyncedProjectionRef = useRef<Projection | undefined>(undefined);
  const importInputRef = useRef<HTMLInputElement>(null);
  const commandQueueRef = useRef(new SerialTaskQueue());
  const applyRefreshCoordinatorRef = useRef(new ApplyRefreshCoordinator());
  const retainedInteractionLocksRef = useRef(new Set<InteractionLockLease>());
  const initialLoadSequenceRef = useRef(0);
  const toolResultSequenceRef = useRef(0);
  const toolResultAbortRef = useRef<AbortController | undefined>(undefined);
  const forwardCommandRef = useRef<
    ((optimisticProjection: Projection, command: Command) => void | Promise<void>) | undefined
  >(undefined);

  const installProjection = useCallback((projection: Projection) => {
    lastSyncedProjectionRef.current = projection;
    if (storeRef.current) {
      storeRef.current.replaceProjection(projection);
      return;
    }
    const nextStore = new EditorStore({
      projection,
      clientId: `mcp-view-${crypto.randomUUID()}`,
      onCommit: (optimisticProjection, command) =>
        forwardCommandRef.current?.(optimisticProjection, command),
      onError: (message) => setErrorMessage(message),
    });
    storeRef.current = nextStore;
    setStore(nextStore);
  }, []);

  const retainInteractionLock = useCallback((interactionLock: InteractionLockLease): void => {
    interactionLock.retainUntilReconcile();
    retainedInteractionLocksRef.current.add(interactionLock);
  }, []);

  const releaseRetainedInteractionLocks = useCallback((): void => {
    for (const interactionLock of retainedInteractionLocksRef.current) {
      interactionLock.releaseAfterReconcile();
    }
    retainedInteractionLocksRef.current.clear();
  }, []);

  const acceptProjection = useCallback(
    (projection: Projection): boolean => {
      const currentProjection =
        storeRef.current?.getProjection() ?? lastSyncedProjectionRef.current;
      if (!shouldInstallProjection(currentProjection, projection)) {
        return false;
      }
      installProjection(projection);
      releaseRetainedInteractionLocks();
      setStatus(`Synced · revision ${projection.document.revision}`);
      setErrorMessage(undefined);
      setInitialLoadError(undefined);
      return true;
    },
    [installProjection, releaseRetainedInteractionLocks],
  );

  const acceptAuthoritativeProjection = useCallback(
    (projection: Projection): boolean => {
      const current = storeRef.current?.getProjection() ?? lastSyncedProjectionRef.current;
      if (
        retainedInteractionLocksRef.current.size > 0 &&
        current?.document.id === projection.document.id
      ) {
        installProjection(projection);
        releaseRetainedInteractionLocks();
        setStatus(`Synced · revision ${projection.document.revision}`);
        setErrorMessage(undefined);
        setInitialLoadError(undefined);
        return true;
      }
      return acceptProjection(projection);
    },
    [acceptProjection, installProjection, releaseRetainedInteractionLocks],
  );

  const acceptResult = useCallback(
    (result: CallToolResult): boolean => {
      const failure = readToolFailure(result);
      if (failure) {
        setErrorMessage(failure);
        return false;
      }

      const projection = readProjection(result);
      if (projection) {
        // Stale same-Document results are successful responses, but cannot replace newer state.
        acceptProjection(projection);
      }
      return true;
    },
    [acceptProjection],
  );

  const refresh = useCallback(
    async (app: App, guard: () => boolean = () => true): Promise<boolean> => {
      const isCurrent = () => appRef.current === app && guard();
      if (!isCurrent()) return false;
      const loaded = await loadInitialProjection(
        () =>
          app.callServerTool(
            { name: KOI_MCP_TOOL_NAMES.openCanvas, arguments: {} },
            { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) },
          ),
        (request) => requestSnapshotChunk(app, request),
        (completed, total) => {
          if (isCurrent()) setStatus(`Refreshing canvas… ${completed}/${total}`);
        },
      );
      if (!isCurrent()) return false;
      if (!loaded.ok) {
        setErrorMessage(loaded.message);
        return false;
      }
      const { projection } = loaded;
      const current = lastSyncedProjectionRef.current;
      if (current?.document.id === projection.document.id && current.cursor > projection.cursor) {
        setErrorMessage(undefined);
        return true;
      }
      if (!acceptAuthoritativeProjection(projection)) {
        setErrorMessage("The MCP server returned a canvas for a different View lifecycle");
        return false;
      }
      return true;
    },
    [acceptAuthoritativeProjection],
  );

  const acknowledgeLocalCommand = useCallback((commandId: string): void => {
    const current = storeRef.current?.getProjection();
    if (!current) return;
    const acknowledged = acknowledgePendingCommand(current, commandId);
    if (acknowledged === current) return;

    storeRef.current?.replaceProjection(acknowledged);
    if (acknowledged.outbox.length === 0) {
      lastSyncedProjectionRef.current = acknowledged;
    }
  }, []);

  const refreshAfterApply = useCallback(
    (app: App, commandId: string): Promise<boolean> =>
      applyRefreshCoordinatorRef.current.request(
        commandId,
        () => acknowledgeLocalCommand(commandId),
        async () => {
          if (appRef.current !== app) return false;
          const interactionLock = new InteractionLockLease(
            storeRef.current?.acquireInteractionLock(),
          );
          setStatus("Refreshing committed canvas…");
          try {
            const refreshed = await refresh(app);
            if (!refreshed && appRef.current === app) {
              retainInteractionLock(interactionLock);
              setStatus("Change committed · refresh unavailable");
            }
            return refreshed;
          } catch (refreshError) {
            if (appRef.current === app) {
              retainInteractionLock(interactionLock);
              setStatus("Change committed · refresh unavailable");
              setErrorMessage(
                refreshError instanceof Error
                  ? refreshError.message
                  : "Could not refresh the committed canvas",
              );
            }
            return false;
          } finally {
            interactionLock.finish();
          }
        },
      ),
    [acknowledgeLocalCommand, refresh, retainInteractionLock],
  );

  const handleToolResult = useCallback(
    (sourceApp: App, result: CallToolResult): void => {
      const sequence = ++toolResultSequenceRef.current;
      toolResultAbortRef.current?.abort();
      toolResultAbortRef.current = undefined;
      const snapshotTransfer = readSnapshotTransfer(result);
      const importAcknowledgement = readImportAcknowledgement(result);
      if (snapshotTransfer && importAcknowledgement) {
        if (appRef.current !== sourceApp) return;
        const controller = new AbortController();
        toolResultAbortRef.current = controller;
        const interactionLock = new InteractionLockLease(
          storeRef.current?.acquireInteractionLock(),
        );
        retainInteractionLock(interactionLock);
        const guard = () =>
          sequence === toolResultSequenceRef.current && appRef.current === sourceApp;
        setStatus("Loading imported canvas…");
        void reconcileCommittedProjectionResult(
          result,
          (request) => requestSnapshotChunk(sourceApp, request, controller.signal),
          acceptProjection,
          () => refresh(sourceApp, guard),
          (completed, total) => {
            if (guard()) setStatus(`Loading imported canvas… ${completed}/${total}`);
          },
        )
          .then((outcome) => {
            if (!guard()) return;
            if (outcome.kind === "installed") {
              setStatus(`Imported · revision ${storeRef.current?.getDocument().revision ?? "?"}`);
              return;
            }
            if (outcome.kind === "refreshed") {
              setStatus("Imported; refreshed latest canvas");
              return;
            }
            if (outcome.kind === "refresh-unavailable") {
              setStatus("Import committed; refresh unavailable");
              setErrorMessage(
                `${outcome.message}. The import was saved, but the latest canvas could not be loaded; reopen the View to retry.`,
              );
              return;
            }
            setStatus(outcome.kind === "tool-failure" ? "Import failed" : "Import status unknown");
            setErrorMessage(outcome.message);
          })
          .finally(() => {
            if (toolResultAbortRef.current === controller) {
              toolResultAbortRef.current = undefined;
            }
            interactionLock.finish();
          });
        return;
      }

      if (!snapshotTransfer) {
        const acknowledgement = readApplyAcknowledgement(result);
        if (acknowledgement && !readProjection(result)) {
          if (appRef.current !== sourceApp) return;
          if (acknowledgement.refreshRequired) {
            void refreshAfterApply(sourceApp, acknowledgement.receipt.commandId);
          } else {
            acknowledgeLocalCommand(acknowledgement.receipt.commandId);
            acceptResult(result);
          }
          return;
        }
        acceptResult(result);
        return;
      }

      // During initial connect, the normal initial-load effect opens the latest server snapshot.
      if (appRef.current !== sourceApp) {
        return;
      }
      const controller = new AbortController();
      toolResultAbortRef.current = controller;
      const releaseInteractionLock = storeRef.current?.acquireInteractionLock();
      setStatus("Loading updated canvas…");
      void loadProjectionResult(
        result,
        (request) => requestSnapshotChunk(sourceApp, request, controller.signal),
        (completed, total) => {
          if (sequence === toolResultSequenceRef.current && appRef.current === sourceApp) {
            setStatus(`Loading updated canvas… ${completed}/${total}`);
          }
        },
      )
        .then((loaded) => {
          if (sequence !== toolResultSequenceRef.current || appRef.current !== sourceApp) {
            return;
          }
          if (!loaded.ok) {
            setStatus("Canvas refresh failed");
            setErrorMessage(`${loaded.message}. Reopen the canvas and retry.`);
            return;
          }
          if (!acceptProjection(loaded.projection)) {
            const current = storeRef.current?.getProjection();
            if (current) {
              setStatus(`Synced · revision ${current.document.revision}`);
            }
          }
        })
        .finally(() => {
          if (toolResultAbortRef.current === controller) {
            toolResultAbortRef.current = undefined;
          }
          releaseInteractionLock?.();
        });
    },
    [
      acceptProjection,
      acceptResult,
      acknowledgeLocalCommand,
      refresh,
      refreshAfterApply,
      retainInteractionLock,
    ],
  );

  const forwardCommand = useCallback(
    (_optimisticProjection: Projection, command: Command): Promise<void> => {
      const interactionLock = new InteractionLockLease(storeRef.current?.acquireInteractionLock());
      return commandQueueRef.current
        .run(async () => {
          const app = appRef.current;
          let dispatched = false;
          try {
            if (!app?.getHostCapabilities()?.serverTools) {
              const lastSynced = lastSyncedProjectionRef.current;
              if (lastSynced) {
                storeRef.current?.replaceProjection(lastSynced);
              }
              setStatus("Read only · host blocks View tool calls");
              return;
            }

            setStatus("Saving…");
            const request = {
              name: KOI_MCP_TOOL_NAMES.applyCommand,
              arguments: { command },
            };
            dispatched = true;
            const call = await callWithOneExactRetry(() =>
              app.callServerTool(request, { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) }),
            );
            if (!call.ok) {
              retainInteractionLock(interactionLock);
              setStatus("Save outcome unknown · local change retained");
              setErrorMessage(
                `${call.error instanceof Error ? call.error.message : "The MCP transport failed"}. The exact Command was retried once but may have committed; reopen the canvas to reconcile.`,
              );
              return;
            }
            const ambiguousRetryFailure = readAmbiguousRetryFailure(call);
            if (ambiguousRetryFailure) {
              retainInteractionLock(interactionLock);
              setStatus("Save outcome unknown · local change retained");
              setErrorMessage(
                `The first attempt disconnected and its exact retry returned: ${ambiguousRetryFailure}. The Command may have committed; reopen the canvas to reconcile.`,
              );
              return;
            }
            const result = call.value;
            if (!acceptResult(result)) {
              const recovery = await recoverRejectedCommand(
                storeRef.current,
                lastSyncedProjectionRef.current,
                () => refresh(app),
              );
              setStatus(
                recovery === "refreshed"
                  ? "Conflict · refreshed from server"
                  : "Conflict · local edit reverted; refresh unavailable",
              );
              return;
            }

            if (!readProjection(result)) {
              const acknowledgement = readApplyAcknowledgement(result);
              if (!acknowledgement || acknowledgement.receipt.commandId !== command.commandId) {
                throw new Error("The MCP server returned an invalid Command acknowledgement");
              }
              if (acknowledgement.refreshRequired) {
                await refreshAfterApply(app, command.commandId);
              } else {
                acknowledgeLocalCommand(command.commandId);
                setStatus(`Synced · revision ${storeRef.current?.getDocument().revision ?? "?"}`);
              }
            }

            if (app.getHostCapabilities()?.updateModelContext?.structuredContent) {
              void app
                .updateModelContext({
                  content: [
                    {
                      type: "text",
                      text: `The human committed Koi Command ${command.commandId}.`,
                    },
                  ],
                  structuredContent: modelContextForCommand(
                    command,
                    storeRef.current?.getDocument().revision ?? 0,
                  ),
                })
                .catch(() => {
                  // Context propagation is advisory; the durable Command is already committed.
                });
            }
          } catch (error) {
            if (dispatched) {
              retainInteractionLock(interactionLock);
              setStatus("Save outcome unknown · local change retained");
              setErrorMessage(
                `${error instanceof Error ? error.message : "The MCP response was invalid"}. The Command may have committed; reopen the canvas to reconcile.`,
              );
              return;
            }
            const lastSynced = lastSyncedProjectionRef.current;
            if (lastSynced) {
              storeRef.current?.replaceProjection(lastSynced);
            }
            setStatus("Offline · local edit reverted");
            setErrorMessage(error instanceof Error ? error.message : "Could not save the edit");
            throw error;
          }
        })
        .finally(() => interactionLock.finish());
    },
    [acceptResult, acknowledgeLocalCommand, refresh, refreshAfterApply, retainInteractionLock],
  );
  forwardCommandRef.current = forwardCommand;

  const loadInitialCanvas = useCallback(
    async (targetApp: App): Promise<void> => {
      const sequence = ++initialLoadSequenceRef.current;
      setInitialLoadError(undefined);
      setStatus("Loading canvas…");
      const loaded = await loadInitialProjection(
        () =>
          targetApp.callServerTool(
            { name: KOI_MCP_TOOL_NAMES.openCanvas, arguments: {} },
            { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) },
          ),
        (request) => requestSnapshotChunk(targetApp, request),
        (completed, total) => {
          if (sequence === initialLoadSequenceRef.current && appRef.current === targetApp) {
            setStatus(`Loading canvas… ${completed}/${total}`);
          }
        },
      );
      if (sequence !== initialLoadSequenceRef.current || appRef.current !== targetApp) {
        return;
      }
      if (!loaded.ok) {
        setStatus("Canvas unavailable");
        setInitialLoadError({
          message: `${loaded.message}. Check that the MCP server is running, then retry.`,
          retryable: true,
        });
        return;
      }
      acceptAuthoritativeProjection(loaded.projection);
    },
    [acceptAuthoritativeProjection],
  );

  const { app, error } = useApp({
    appInfo: { name: "Koi canvas", version: "0.1.0" },
    capabilities: {},
    autoResize: false,
    strict: true,
    onAppCreated: (createdApp) => {
      createdApp.ontoolinput = () => {
        setStatus("Receiving canvas…");
      };
      createdApp.ontoolinputpartial = () => {
        setStatus("Agent is preparing the canvas…");
      };
      createdApp.ontoolresult = (result) => handleToolResult(createdApp, result);
      createdApp.ontoolcancelled = (params) => {
        setStatus("Cancelled");
        setErrorMessage(params.reason ?? "The tool call was cancelled");
      };
      createdApp.onhostcontextchanged = (context) => {
        setHostContext((current) => ({ ...current, ...context }));
      };
      createdApp.onteardown = async () => ({});
      createdApp.onerror = (appError) => {
        setErrorMessage(appError.message);
      };
    },
  });

  useHostStyles(app, app?.getHostContext());

  useEffect(() => {
    if (!app) {
      return;
    }
    appRef.current = app;
    setHostContext(app.getHostContext());

    if (!storeRef.current || retainedInteractionLocksRef.current.size > 0) {
      if (app.getHostCapabilities()?.serverTools) {
        void loadInitialCanvas(app);
      } else {
        setStatus("Canvas unavailable");
        setInitialLoadError({
          message: "This MCP host did not grant the View access to server tools.",
          retryable: false,
        });
      }
    }
    return () => {
      if (appRef.current === app) {
        appRef.current = null;
        initialLoadSequenceRef.current += 1;
        toolResultSequenceRef.current += 1;
        toolResultAbortRef.current?.abort();
        toolResultAbortRef.current = undefined;
        applyRefreshCoordinatorRef.current = new ApplyRefreshCoordinator();
      }
    };
  }, [app, loadInitialCanvas]);

  const exportCurrentDocument = useCallback(async () => {
    const connectedApp = appRef.current;
    const currentStore = storeRef.current;
    if (!connectedApp || !currentStore) {
      return;
    }
    try {
      const result = await connectedApp.callServerTool(
        {
          name: KOI_MCP_TOOL_NAMES.exportDocument,
          arguments: { expectedRevision: currentStore.getDocument().revision },
        },
        { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) },
      );
      const failure = readToolFailure(result);
      const exported = readExport(result);
      if (failure || !exported) {
        throw new Error(failure ?? "The export response was invalid");
      }
      if (!connectedApp.getHostCapabilities()?.downloadFile) {
        throw new Error("This MCP host does not support file downloads");
      }
      const download = await connectedApp.downloadFile({
        contents: [
          {
            type: "resource",
            resource: {
              uri: fileUri(exported.filename),
              mimeType: exported.mediaType,
              text: exported.documentJson,
            },
          },
        ],
      });
      if (download.isError) {
        throw new Error("The host declined the download");
      }
      setStatus(`Exported · revision ${currentStore.getDocument().revision}`);
    } catch (exportError) {
      setErrorMessage(
        exportError instanceof Error ? exportError.message : "Could not export the Document",
      );
    }
  }, []);

  const importSelectedDocument = useCallback(
    async (file: File) => {
      if (file.size > MAX_TOOL_DOCUMENT_BYTES) {
        setErrorMessage(`Imports are limited to ${MAX_TOOL_DOCUMENT_BYTES} bytes in an MCP View`);
        return;
      }

      const interactionLock = new InteractionLockLease(storeRef.current?.acquireInteractionLock());
      return commandQueueRef.current
        .run(async () => {
          const connectedApp = appRef.current;
          const currentStore = storeRef.current;
          if (!connectedApp || !currentStore) return;

          let dispatched = false;
          try {
            setStatus("Importing…");
            const documentJson = await file.text();
            const request = {
              name: KOI_MCP_TOOL_NAMES.importDocument,
              arguments: {
                commandId: `import-${crypto.randomUUID()}`,
                expectedDocumentId: currentStore.getDocument().id,
                expectedRevision: currentStore.getDocument().revision,
                documentJson,
              },
            };
            dispatched = true;
            const call = await callWithOneExactRetry(() =>
              connectedApp.callServerTool(request, {
                signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
              }),
            );
            if (!call.ok) {
              retainInteractionLock(interactionLock);
              setStatus("Import outcome unknown");
              setErrorMessage(
                `${call.error instanceof Error ? call.error.message : "The MCP transport failed"}. The exact import was retried once but may have committed; reopen the View to reconcile.`,
              );
              return;
            }
            const ambiguousRetryFailure = readAmbiguousRetryFailure(call);
            if (ambiguousRetryFailure) {
              retainInteractionLock(interactionLock);
              setStatus("Import outcome unknown");
              setErrorMessage(
                `The first attempt disconnected and its exact retry returned: ${ambiguousRetryFailure}. The import may have committed; reopen the View to reconcile.`,
              );
              return;
            }
            const result = call.value;
            const outcome = await reconcileCommittedProjectionResult(
              result,
              (request) => requestSnapshotChunk(connectedApp, request),
              acceptProjection,
              () => refresh(connectedApp),
              (completed, total) => setStatus(`Importing canvas… ${completed}/${total}`),
            );

            if (outcome.kind === "installed") {
              setStatus(`Imported · revision ${currentStore.getDocument().revision}`);
              return;
            }
            if (outcome.kind === "refreshed") {
              setStatus("Imported; refreshed latest canvas");
              return;
            }
            if (outcome.kind === "refresh-unavailable") {
              retainInteractionLock(interactionLock);
              setStatus("Import committed; refresh unavailable");
              setErrorMessage(
                `${outcome.message}. The import was saved, but the latest canvas could not be loaded; reopen the View to retry.`,
              );
              return;
            }
            if (outcome.kind === "invalid-result") {
              retainInteractionLock(interactionLock);
            }
            setStatus(outcome.kind === "tool-failure" ? "Import failed" : "Import status unknown");
            setErrorMessage(outcome.message);
          } catch (importError) {
            if (dispatched) retainInteractionLock(interactionLock);
            setStatus(dispatched ? "Import outcome unknown" : "Import failed");
            setErrorMessage(
              importError instanceof Error ? importError.message : "Could not import the Document",
            );
          }
        })
        .finally(() => interactionLock.finish());
    },
    [acceptProjection, refresh, retainInteractionLock],
  );

  const safeArea = hostContext?.safeAreaInsets;
  const shellStyle = safeArea
    ? {
        paddingTop: safeArea.top,
        paddingRight: safeArea.right,
        paddingBottom: safeArea.bottom,
        paddingLeft: safeArea.left,
      }
    : undefined;

  if (error) {
    return (
      <main className="koi-view-state koi-view-error">Could not connect: {error.message}</main>
    );
  }

  return (
    <div className="koi-mcp-view" style={shellStyle}>
      {errorMessage ? (
        <div className="koi-view-banner" role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(undefined)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {store ? (
        <KoiEditor
          store={store}
          title="Koi · MCP"
          status={status}
          onExport={() => void exportCurrentDocument()}
          onImport={() => importInputRef.current?.click()}
        />
      ) : (
        <main className="koi-view-state" aria-live="polite">
          {initialLoadError ? null : <span className="koi-view-spinner" aria-hidden="true" />}
          <strong>{initialLoadError ? "Canvas unavailable" : status}</strong>
          <small>
            {initialLoadError?.message ??
              "Waiting for a bounded Koi canvas snapshot or paginated transfer from the host."}
          </small>
          {initialLoadError?.retryable ? (
            <button
              className="koi-view-retry"
              type="button"
              onClick={() => {
                const connectedApp = appRef.current;
                if (connectedApp) void loadInitialCanvas(connectedApp);
              }}
            >
              Retry
            </button>
          ) : null}
        </main>
      )}
      <input
        ref={importInputRef}
        className="koi-hidden-input"
        type="file"
        accept="application/json,.json,.koi.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            void importSelectedDocument(file);
          }
        }}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Koi MCP View root was not found");
}

createRoot(root).render(
  <StrictMode>
    <KoiMcpView />
  </StrictMode>,
);
