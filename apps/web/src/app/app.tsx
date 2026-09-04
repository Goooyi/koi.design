import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack } from "@astryxdesign/core/HStack";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Token } from "@astryxdesign/core/Token";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  acknowledgeAllOutboxEntries,
  acknowledgeOutboxEntry,
  createInitialProjection,
  exportDocument,
  importDocument,
  KOI_DOCUMENT_MEDIA_TYPE,
  MAX_KOI_DOCUMENT_IMPORT_BYTES,
  updateOutboxEntry,
  type Command,
  type Projection,
} from "@koi/core";
import { CameraController, EditorStore, KoiEditor, type EditorStatusTone } from "@koi/editor";

import {
  HostedKoiClient,
  HostedPublishOutcomeUnknownError,
  type HostedPublishRequest,
} from "../hosting/client.js";
import { attemptHostedPublish, HostedPublishIntentCoordinator } from "../hosting/publish-intent.js";
import { recoverHostedOutbox } from "../hosting/recover-outbox.js";
import { resolveHostedTransitionTarget } from "../hosting/resolve-transition.js";
import { HostedRevisionTracker } from "../hosting/revision-tracker.js";
import {
  IndexedDbProjectionRepository,
  type DocumentAuthority,
} from "../persistence/indexeddb/projection-repository.js";
import { registerKoiWebMcp } from "../webmcp/tools.js";
import { createWelcomeProjection } from "./seed.js";
import {
  localReturnDocumentIdForTransition,
  publishAfterCheckpoint,
  runWithSuspendedHostedSession,
  TransitionCoordinator,
} from "./transition-coordinator.js";

type SyncState =
  | "Local"
  | "Hosted offline"
  | "Connecting"
  | "Synced"
  | "Syncing"
  | "Sync error"
  | "Publish outcome unknown";
type ConnectMode = "open" | "publish";

const LOCAL_RETURN_KEY = "koi.host.localReturnDocumentId";
const HOST_BASE_URL_KEY = "koi.host.baseUrl";
const IS_STANDALONE_DEPLOYMENT = __KOI_DEPLOYMENT_MODE__ === "standalone";
const BUILD_LABEL = `Koi v${__KOI_VERSION__} · ${__KOI_BUILD_ID__.slice(0, 12)}`;

function readLocalReturnId(): string | null {
  try {
    return localStorage.getItem(LOCAL_RETURN_KEY);
  } catch {
    return null;
  }
}

function readHostBaseUrl(fallback: string): string {
  try {
    return sessionStorage.getItem(HOST_BASE_URL_KEY) ?? fallback;
  } catch {
    return fallback;
  }
}

function rememberHostBaseUrl(baseUrl: string): void {
  try {
    sessionStorage.setItem(HOST_BASE_URL_KEY, baseUrl);
  } catch {
    // The authenticated client remains in memory; this value only prefills a later dialog.
  }
}

function downloadDocument(projection: Projection) {
  const source = exportDocument(projection.document);
  const url = URL.createObjectURL(new Blob([source], { type: KOI_DOCUMENT_MEDIA_TYPE }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projection.document.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.koi.json`;
  link.click();
  URL.revokeObjectURL(url);
}

interface ConnectPanelProps {
  busy: boolean;
  error: string | null;
  initialBaseUrl: string;
  onCancel: () => void;
  onConnect: (baseUrl: string, token: string, mode: ConnectMode) => Promise<void>;
}

function ConnectPanel({ busy, error, initialBaseUrl, onCancel, onConnect }: ConnectPanelProps) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<ConnectMode>("open");
  const close = (isOpen: boolean) => {
    if (!isOpen && !busy) onCancel();
  };
  return (
    <Dialog isOpen purpose="form" width={460} padding={5} onOpenChange={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onConnect(baseUrl, token, mode);
        }}
      >
        <VStack gap={4}>
          <DialogHeader
            title="Connect to your workspace"
            subtitle="Self-hosted Koi"
            onOpenChange={close}
          />
          <Text size="sm" color="secondary">
            Enter this deployment’s owner token. It stays in this browser tab and is never written
            into a Koi Document.
          </Text>
          <FormLayout>
            <TextInput
              label="Server URL"
              type="text"
              value={baseUrl}
              onChange={setBaseUrl}
              isDisabled={busy}
              isRequired
            />
            <RadioList
              label="After connecting"
              value={mode}
              onChange={(next) => setMode(next as ConnectMode)}
              isDisabled={busy}
            >
              <RadioListItem
                value="open"
                label="Open hosted canvas"
                description="Your current local canvas stays in this browser."
              />
              <RadioListItem
                value="publish"
                label="Publish this canvas"
                description="Replace the first hosted canvas with the current local content."
              />
            </RadioList>
            <TextInput
              label="Owner token"
              type="password"
              value={token}
              onChange={setToken}
              isDisabled={busy}
              isRequired
            />
          </FormLayout>
          {error && <Banner status="error" title="Connection failed" description={error} />}
          <HStack gap={2} justify="end">
            <Button
              variant="secondary"
              label="Keep working locally"
              onClick={onCancel}
              isDisabled={busy}
            />
            <Button
              type="submit"
              variant="primary"
              label={busy ? "Connecting…" : "Connect"}
              isDisabled={busy}
              isLoading={busy}
            />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  );
}

/**
 * Surfaces host messages through Astryx's toast stack. The `koi-toast` hook on the body is the
 * stable handle the browser journeys read.
 */
function HostMessages({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const showToast = useToast();
  const latest = useRef(message);
  latest.current = message;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!message) return;
    // One host message at a time: a newer message overwrites the toast in place instead of
    // stacking beneath the previous one.
    const dismiss = showToast({
      type: "info",
      isAutoHide: false,
      uniqueID: "koi-host-message",
      collisionBehavior: "overwrite",
      body: <span className="koi-toast">{message}</span>,
      onHide: () => {
        if (latest.current === message) dismissRef.current();
      },
    });
    return () => {
      if (latest.current === null) dismiss();
    };
  }, [message, showToast]);
  return null;
}

export function App() {
  const repository = useMemo(() => new IndexedDbProjectionRepository(), []);
  const camera = useMemo(() => new CameraController(), []);
  const storeRef = useRef<EditorStore | null>(null);
  const hostedClient = useRef<HostedKoiClient | null>(null);
  const authorityRef = useRef<DocumentAuthority>({ kind: "local" });
  const revisionWatcher = useRef<AbortController | null>(null);
  const revisionTracker = useRef(new HostedRevisionTracker());
  const publishIntents = useRef(new HostedPublishIntentCoordinator());
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);
  const [store, setStore] = useState<EditorStore | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("Local");
  const [webMcpState, setWebMcpState] = useState("WebMCP unavailable");
  const [showLogin, setShowLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dismissMessage = useCallback(() => setMessage(null), []);
  const [localReturnId, setLocalReturnId] = useState(readLocalReturnId);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const transitionCoordinator = useMemo(() => new TransitionCoordinator(setTransitionBusy), []);
  const setOperationalSyncState = useCallback((nextState: SyncState) => {
    setSyncState(publishIntents.current.hasUnresolved() ? "Publish outcome unknown" : nextState);
  }, []);

  const rememberLocalReturn = (documentId: string | null) => {
    setLocalReturnId(documentId);
    try {
      if (documentId) localStorage.setItem(LOCAL_RETURN_KEY, documentId);
      else localStorage.removeItem(LOCAL_RETURN_KEY);
    } catch {
      // The in-memory return action still works when persistent browser storage is unavailable.
    }
  };

  const reconcileHosted = useCallback(
    async (client: HostedKoiClient, documentId: string) => {
      const activeAuthority = authorityRef.current;
      if (
        hostedClient.current !== client ||
        activeAuthority.kind !== "hosted" ||
        activeAuthority.baseUrl !== client.baseUrl
      ) {
        return;
      }
      const currentStore = storeRef.current;
      if (!currentStore || currentStore.getDocument().id !== documentId) return;
      const current = currentStore.getProjection();
      const hasPending = current.outbox.some((entry) => entry.status !== "acknowledged");
      const target = revisionTracker.current.target(current.cursor, hasPending);
      if (target === undefined) return;

      const projection = await client.getProjection(documentId);
      const latestAuthority = authorityRef.current;
      if (
        hostedClient.current !== client ||
        latestAuthority.kind !== "hosted" ||
        latestAuthority.baseUrl !== client.baseUrl
      ) {
        return;
      }
      const latestStore = storeRef.current;
      if (!latestStore || latestStore.getDocument().id !== documentId) return;
      const latest = latestStore.getProjection();
      if (latest.outbox.some((entry) => entry.status !== "acknowledged")) {
        revisionTracker.current.observe(projection.cursor);
        return;
      }
      if (projection.cursor < target) {
        revisionTracker.current.observe(target);
        return;
      }
      latestStore.replaceProjection(projection);
      const authority = { kind: "hosted", baseUrl: client.baseUrl } as const;
      authorityRef.current = authority;
      await repository.save({ projection, authority });
      revisionTracker.current.markApplied(projection.cursor);
    },
    [repository],
  );

  useEffect(() => {
    let disposed = false;
    const onCommit = async (projection: Projection, command: Command) => {
      const authority = authorityRef.current;
      const client = authority.kind === "hosted" ? hostedClient.current : null;
      const committingStore = storeRef.current;
      const releaseInteractionLock = client ? committingStore?.acquireInteractionLock() : undefined;
      const operation = syncQueue.current.then(async () => {
        if (authority.kind === "local") {
          const currentStore = storeRef.current;
          const current = currentStore?.getProjection();
          if (current?.outbox.some((entry) => entry.commandId === command.commandId)) {
            const acknowledged = acknowledgeOutboxEntry(current, command.commandId);
            await repository.save({ projection: acknowledged, authority });
            const latest = currentStore!.getProjection();
            if (latest.outbox.some((entry) => entry.commandId === command.commandId)) {
              currentStore!.replaceProjection(acknowledgeOutboxEntry(latest, command.commandId));
            }
          }
          return;
        }

        await repository.save({ projection, authority });
        if (!client) {
          if (!disposed) {
            setOperationalSyncState("Hosted offline");
            setMessage("Edit saved to the hosted outbox. Reconnect to deliver it.");
          }
          return;
        }
        setOperationalSyncState("Syncing");
        let deliveredCursor: number;
        try {
          const delivered = await client.sendCommand(command.documentId, command);
          deliveredCursor = delivered.cursor;
        } catch (error) {
          const currentStore = storeRef.current;
          const current = currentStore?.getProjection();
          if (current?.outbox.some((entry) => entry.commandId === command.commandId)) {
            const failed = updateOutboxEntry(current, command.commandId, {
              status: "failed",
              error: error instanceof Error ? error.message : "Sync failed",
            });
            currentStore!.replaceProjection(failed);
            await repository.save({ projection: failed, authority });
          }
          if (!disposed) setOperationalSyncState("Sync error");
          return;
        }

        revisionTracker.current.observe(deliveredCursor);
        const currentStore = storeRef.current;
        const current = currentStore?.getProjection();
        if (current?.outbox.some((entry) => entry.commandId === command.commandId)) {
          const acknowledged = acknowledgeOutboxEntry(current, command.commandId);
          currentStore!.replaceProjection(acknowledged);
          await repository.save({ projection: acknowledged, authority });
        }
        try {
          await reconcileHosted(client, command.documentId);
          if (!disposed) {
            setOperationalSyncState(hostedClient.current === client ? "Synced" : "Hosted offline");
          }
        } catch (error) {
          revisionTracker.current.observe(deliveredCursor);
          const currentStore = storeRef.current;
          if (currentStore && !disposed) {
            setOperationalSyncState("Sync error");
            setMessage(
              error instanceof Error
                ? `Saved remotely, but refresh failed: ${error.message}`
                : "Saved remotely, but the hosted snapshot could not be refreshed.",
            );
          }
        }
      });
      syncQueue.current = operation.catch(() => undefined);
      try {
        await operation;
      } catch (error) {
        if (!disposed) {
          setOperationalSyncState("Sync error");
          setMessage(error instanceof Error ? error.message : "The edit could not be saved.");
        }
        throw error;
      } finally {
        releaseInteractionLock?.();
      }
    };

    void (async () => {
      try {
        const stored = await repository.loadActive();
        const authority = stored?.authority ?? ({ kind: "local" } as const);
        const projection =
          authority.kind === "local"
            ? acknowledgeAllOutboxEntries(stored?.projection ?? createWelcomeProjection())
            : stored!.projection;
        authorityRef.current = authority;
        await repository.save({ projection, authority });
        if (disposed) return;
        const nextStore = new EditorStore({
          projection,
          onCommit,
          onError: (error) => setMessage(error),
        });
        storeRef.current = nextStore;
        setStore(nextStore);
        setSyncState(authority.kind === "hosted" ? "Hosted offline" : "Local");
      } catch (error) {
        if (!disposed) {
          setMessage(error instanceof Error ? error.message : "Koi could not open local storage.");
        }
      }
    })();
    return () => {
      disposed = true;
      revisionWatcher.current?.abort();
    };
  }, [reconcileHosted, repository, setOperationalSyncState]);

  useEffect(() => {
    if (!store) return;
    const lifetime = new AbortController();
    let cleanup: (() => void) | undefined;
    void registerKoiWebMcp({ store, camera }, undefined, lifetime)
      .then((dispose) => {
        if (lifetime.signal.aborted) {
          dispose();
          return;
        }
        cleanup = dispose;
        setWebMcpState(document.modelContext ? "WebMCP ready" : "WebMCP unavailable");
      })
      .catch((error: unknown) => {
        if (lifetime.signal.aborted) return;
        setWebMcpState("WebMCP error");
        setMessage(error instanceof Error ? error.message : "WebMCP registration failed.");
      });
    return () => {
      lifetime.abort();
      cleanup?.();
    };
  }, [camera, store]);

  const startWatching = (client: HostedKoiClient, documentId: string) => {
    revisionWatcher.current?.abort();
    const abort = new AbortController();
    revisionWatcher.current = abort;
    const after = storeRef.current?.getProjection().cursor ?? 0;
    void client
      .watchRevisions(
        documentId,
        after,
        async (cursor) => {
          revisionTracker.current.observe(cursor);
          const operation = syncQueue.current.then(() => reconcileHosted(client, documentId));
          syncQueue.current = operation.catch(() => undefined);
          await operation;
        },
        abort.signal,
      )
      .catch((error: unknown) => {
        if (abort.signal.aborted || revisionWatcher.current !== abort) return;
        const authority = authorityRef.current;
        if (
          hostedClient.current !== client ||
          authority.kind !== "hosted" ||
          authority.baseUrl !== client.baseUrl
        )
          return;
        revisionWatcher.current = null;
        hostedClient.current = null;
        setOperationalSyncState("Hosted offline");
        setMessage(
          `${error instanceof Error ? error.message : "Revision stream disconnected."} Reconnect to resume hosted sync.`,
        );
      });
  };

  const connect = async (baseUrl: string, token: string, mode: ConnectMode) => {
    setLoginError(null);
    setSyncState("Connecting");
    const activeStore = storeRef.current!;
    await transitionCoordinator.run(
      activeStore,
      () => syncQueue.current,
      async () => {
        const currentAuthority = authorityRef.current;
        const priorClient = hostedClient.current;
        const priorDocumentId = activeStore.getDocument().id;
        const priorWatcher = revisionWatcher.current;
        const canResumePriorSession =
          priorClient !== null &&
          priorWatcher !== null &&
          !priorWatcher.signal.aborted &&
          currentAuthority.kind === "hosted" &&
          currentAuthority.baseUrl === priorClient.baseUrl;
        try {
          const { client, nextProjection, recovered } = await runWithSuspendedHostedSession(
            () => priorWatcher?.abort(),
            async () => {
              const localProjection = activeStore.getProjection();
              const client = new HostedKoiClient(baseUrl, token);
              const hostedAuthority = { kind: "hosted", baseUrl: client.baseUrl } as const;
              publishIntents.current.requireUnresolvedBaseUrl(client.baseUrl);
              await client.authenticate();
              let recovered = false;
              let nextProjection: Projection;
              let completedPublishRequest: HostedPublishRequest | null = null;
              if (
                mode === "open" &&
                currentAuthority.kind === "hosted" &&
                currentAuthority.baseUrl === client.baseUrl
              ) {
                publishIntents.current.requireUnresolvedTarget(
                  client.baseUrl,
                  localProjection.document.id,
                );
                recovered = localProjection.outbox.some((entry) => entry.status !== "acknowledged");
                nextProjection = await recoverHostedOutbox(
                  client,
                  localProjection,
                  async (projection) => {
                    activeStore.replaceProjection(projection);
                    await repository.save({ projection, authority: hostedAuthority });
                  },
                  (cursor) => revisionTracker.current.observe(cursor),
                );
              } else {
                const hosted = await client.openOrCreateDocument();
                publishIntents.current.requireUnresolvedTarget(
                  client.baseUrl,
                  hosted.projection.document.id,
                );
                const storedTarget = await repository.load(hosted.projection.document.id);
                // Target-host recovery must not advance the prior host's revision high-water.
                const resolvedTarget = await resolveHostedTransitionTarget({
                  mode,
                  client,
                  source: { projection: localProjection, authority: currentAuthority },
                  hostedAuthority,
                  remoteProjection: hosted.projection,
                  storedTarget,
                  acceptActiveSourceAsAuthoritative:
                    mode === "open" &&
                    publishIntents.current.hasUnresolvedTarget(
                      client.baseUrl,
                      hosted.projection.document.id,
                    ),
                  checkpoint: (state) => repository.checkpoint(state),
                });
                recovered = resolvedTarget.recovered;
                if (mode === "publish") {
                  const published = await attemptHostedPublish(
                    publishIntents.current,
                    client.baseUrl,
                    resolvedTarget.projection,
                    exportDocument(localProjection.document),
                    (request) => client.publishDocument(request),
                  );
                  nextProjection = published.projection;
                  completedPublishRequest = published.request;
                } else {
                  nextProjection = resolvedTarget.projection;
                }
              }
              await publishAfterCheckpoint(
                () => repository.save({ projection: nextProjection, authority: hostedAuthority }),
                () => {
                  revisionTracker.current.reset();
                  const localReturnDocumentId = localReturnDocumentIdForTransition(
                    currentAuthority,
                    localProjection.document.id,
                    nextProjection.document.id,
                  );
                  if (localReturnDocumentId) {
                    rememberLocalReturn(localReturnDocumentId);
                  }
                  hostedClient.current = client;
                  authorityRef.current = hostedAuthority;
                  activeStore.replaceProjection(nextProjection);
                  if (completedPublishRequest) {
                    publishIntents.current.complete(completedPublishRequest);
                  } else if (mode === "open") {
                    publishIntents.current.clearAfterAuthoritativeOpen(
                      client.baseUrl,
                      nextProjection.document.id,
                    );
                  }
                },
              );
              return { client, nextProjection, recovered };
            },
            () => {
              if (!canResumePriorSession) return;
              hostedClient.current = priorClient;
              startWatching(priorClient, priorDocumentId);
            },
          );
          rememberHostBaseUrl(client.baseUrl);
          setShowLogin(false);
          setSyncState("Synced");
          setMessage(
            mode === "publish"
              ? "Published this canvas to your hosted workspace."
              : recovered
                ? "Recovered the hosted outbox and opened the latest canvas."
                : "Opened the hosted canvas; your local canvas remains available.",
          );
          startWatching(client, nextProjection.document.id);
        } catch (error) {
          if (
            error instanceof HostedPublishOutcomeUnknownError ||
            publishIntents.current.hasUnresolved()
          ) {
            revisionWatcher.current?.abort();
            revisionWatcher.current = null;
            publishIntents.current.retainInteractionLock(activeStore);
            const detail =
              error instanceof Error ? error.message : "The hosted transition did not complete.";
            const outcomeMessage = `${detail} The prior Publish remains unresolved and the source canvas stays active.`;
            setSyncState("Publish outcome unknown");
            setLoginError(outcomeMessage);
            setMessage(outcomeMessage);
            return;
          }
          setSyncState(
            canResumePriorSession
              ? "Synced"
              : currentAuthority.kind === "hosted"
                ? "Hosted offline"
                : "Local",
          );
          setLoginError(error instanceof Error ? error.message : "Connection failed.");
        }
      },
    );
  };

  const returnToLocal = async () => {
    if (!localReturnId) return;
    const activeStore = storeRef.current!;
    try {
      await transitionCoordinator.run(
        activeStore,
        () => syncQueue.current,
        async () => {
          publishIntents.current.requireNoUnresolved();
          const stored = await repository.load(localReturnId);
          if (!stored) {
            rememberLocalReturn(null);
            setMessage("The saved local canvas is no longer available.");
            return;
          }
          await publishAfterCheckpoint(
            () => repository.save(stored),
            () => {
              revisionWatcher.current?.abort();
              hostedClient.current = null;
              revisionTracker.current.reset();
              authorityRef.current = stored.authority;
              activeStore.replaceProjection(stored.projection);
            },
          );
          rememberLocalReturn(null);
          setSyncState(stored.authority.kind === "hosted" ? "Hosted offline" : "Local");
          setMessage("Returned to the local canvas.");
        },
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open the local canvas.");
    }
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_KOI_DOCUMENT_IMPORT_BYTES) {
      setMessage("Koi Document imports are limited to 32 MiB.");
      return;
    }
    const activeStore = storeRef.current!;
    try {
      await transitionCoordinator.run(
        activeStore,
        () => syncQueue.current,
        async () => {
          publishIntents.current.requireNoUnresolved();
          const result = importDocument(await file.text());
          if (!result.ok) {
            setMessage(
              result.issues
                .slice(0, 3)
                .map((issue) => issue.message)
                .join(" "),
            );
            return;
          }
          const authority = { kind: "local" } as const;
          const projection = createInitialProjection(result.document);
          await publishAfterCheckpoint(
            () => repository.save({ projection, authority }),
            () => {
              revisionWatcher.current?.abort();
              hostedClient.current = null;
              revisionTracker.current.reset();
              authorityRef.current = authority;
              activeStore.replaceProjection(projection);
            },
          );
          setSyncState("Local");
          setMessage("Imported locally. Choose “Publish this canvas” when connecting to host it.");
        },
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import this Koi Document.");
    }
  };

  if (!store) {
    return (
      <Center height="100%">
        <VStack gap={2} align="center">
          <Spinner size="lg" label="Opening your canvas" />
          <Text color="secondary">{message ?? "Opening your canvas…"}</Text>
        </VStack>
      </Center>
    );
  }

  const busy = transitionBusy || syncState === "Connecting" || syncState === "Syncing";
  const statusTone: EditorStatusTone =
    syncState === "Sync error" ||
    syncState === "Publish outcome unknown" ||
    webMcpState === "WebMCP error"
      ? "error"
      : syncState === "Connecting" ||
          syncState === "Syncing" ||
          syncState === "Hosted offline" ||
          webMcpState === "WebMCP unavailable"
        ? "busy"
        : "ok";
  const hostActions = (
    <>
      <Token
        size="sm"
        label={BUILD_LABEL}
        description={`${BUILD_LABEL} · ${__KOI_DEPLOYMENT_MODE__}`}
        data-testid="koi-build-identifier"
      />
      {!IS_STANDALONE_DEPLOYMENT && localReturnId && localReturnId !== store.getDocument().id ? (
        <Button
          variant="secondary"
          size="sm"
          label="Return to local"
          onClick={returnToLocal}
          isDisabled={busy}
        />
      ) : null}
      {IS_STANDALONE_DEPLOYMENT ? (
        <Token size="sm" color="blue" label="Standalone · browser-local" />
      ) : (
        <Button
          variant="primary"
          size="sm"
          label={syncState === "Synced" ? "Hosted workspace" : "Connect hosting"}
          onClick={() => setShowLogin(true)}
          isDisabled={busy}
        />
      )}
    </>
  );

  return (
    <>
      <KoiEditor
        store={store}
        camera={camera}
        title="Koi"
        status={`${syncState} · ${webMcpState}`}
        statusTone={statusTone}
        actions={hostActions}
        onExport={() => downloadDocument(store.getProjection())}
        onImport={() => fileInput.current?.click()}
      >
        <HostMessages message={message} onDismiss={dismissMessage} />
        {showLogin && !IS_STANDALONE_DEPLOYMENT ? (
          <ConnectPanel
            busy={transitionBusy}
            error={loginError}
            initialBaseUrl={
              authorityRef.current.kind === "hosted"
                ? authorityRef.current.baseUrl
                : readHostBaseUrl(location.origin)
            }
            onCancel={() => setShowLogin(false)}
            onConnect={connect}
          />
        ) : null}
      </KoiEditor>
      <VisuallyHidden>
        <input
          ref={fileInput}
          type="file"
          aria-label="Import Koi document"
          accept={`.json,.koi.json,application/json,${KOI_DOCUMENT_MEDIA_TYPE}`}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = "";
          }}
        />
      </VisuallyHidden>
    </>
  );
}
