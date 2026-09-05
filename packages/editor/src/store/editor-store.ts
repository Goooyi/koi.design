import {
  applyCommand,
  createUndoCommand,
  getPage,
  MAX_OPERATIONS_PER_COMMAND,
  ownRecordValue,
  type ApplyCommandResult,
  type Asset,
  type Command,
  type KoiElement,
  type Operation,
  type Point,
  type Projection,
} from "@koi/core";

type Listener = () => void;
const ZERO_OFFSET: Point = Object.freeze({ x: 0, y: 0 });

export interface EditorStoreOptions {
  projection: Projection;
  clientId?: string;
  createId?: (prefix: string) => string;
  onCommit?: (projection: Projection, command: Command) => void | Promise<void>;
  onError?: (message: string) => void;
}

export interface CommitOptions {
  commandId?: string;
  origin?: Command["origin"];
  signal?: AbortSignal;
}

export type EditorCommitResult =
  | ApplyCommandResult
  | {
      ok: false;
      projection: Projection;
      error: {
        ok: false;
        code: "INTERACTION_LOCKED";
        message: string;
      };
    };

function defaultCreateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class EditorStore {
  readonly clientId: string;
  readonly createId: (prefix: string) => string;

  #projection: Projection;
  #elementsById = new Map<string, KoiElement>();
  #assetsById = new Map<string, Asset>();
  #pageId: string;
  #selection: readonly string[] = [];
  #clientSeq: number;
  #listeners = new Set<Listener>();
  #selectionListeners = new Set<Listener>();
  #elementListeners = new Map<string, Set<Listener>>();
  #previewListeners = new Set<Listener>();
  #previewOffsets = new Map<string, Point>();
  #previewRevision = 0;
  #onCommit?: EditorStoreOptions["onCommit"];
  #onError?: EditorStoreOptions["onError"];
  #commitCompletions = new Map<string, Promise<void>>();
  #interactionLockCount = 0;

  constructor(options: EditorStoreOptions) {
    this.#projection = options.projection;
    this.#rebuildIndexes();
    this.#pageId = options.projection.document.pages[0]!.id;
    this.clientId = options.clientId ?? defaultCreateId("client");
    this.createId = options.createId ?? defaultCreateId;
    this.#clientSeq = ownRecordValue(options.projection.clientHeads, this.clientId)?.clientSeq ?? 0;
    this.#onCommit = options.onCommit;
    this.#onError = options.onError;
  }

  getProjection = (): Projection => this.#projection;

  getDocument = () => this.#projection.document;

  getPageId = (): string => this.#pageId;

  getActivePage = () => getPage(this.#projection.document, this.#pageId);

  getSelection = (): readonly string[] => this.#selection;

  getInteractionLocked = (): boolean => this.#interactionLockCount > 0;

  getElement = (elementId: string): KoiElement | undefined => this.#elementsById.get(elementId);

  getAsset = (assetId: string): Asset | undefined => this.#assetsById.get(assetId);

  getPreviewRevision = (): number => this.#previewRevision;

  getPreviewOffset = (elementId: string): Point =>
    this.#previewOffsets.get(elementId) ?? ZERO_OFFSET;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  subscribeSelection = (listener: Listener): (() => void) => {
    this.#selectionListeners.add(listener);
    return () => this.#selectionListeners.delete(listener);
  };

  subscribePreviews = (listener: Listener): (() => void) => {
    this.#previewListeners.add(listener);
    return () => this.#previewListeners.delete(listener);
  };

  subscribeElement = (elementId: string, listener: Listener): (() => void) => {
    const listeners = this.#elementListeners.get(elementId) ?? new Set<Listener>();
    listeners.add(listener);
    this.#elementListeners.set(elementId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#elementListeners.delete(elementId);
      }
    };
  };

  acquireInteractionLock(): () => void {
    this.#interactionLockCount += 1;
    if (this.#interactionLockCount === 1) this.#notifyAll();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#interactionLockCount -= 1;
      if (this.#interactionLockCount === 0) this.#notifyAll();
    };
  }

  setPreviewOffset(elementId: string, offset: Point): void {
    const current = this.getPreviewOffset(elementId);
    if (current.x === offset.x && current.y === offset.y) return;
    if (offset.x === 0 && offset.y === 0) this.#previewOffsets.delete(elementId);
    else this.#previewOffsets.set(elementId, { ...offset });
    this.#previewRevision += 1;
    for (const listener of this.#previewListeners) listener();
  }

  clearPreviewOffset(elementId: string): void {
    this.setPreviewOffset(elementId, ZERO_OFFSET);
  }

  setPage(pageId: string): void {
    if (!getPage(this.#projection.document, pageId) || pageId === this.#pageId) {
      return;
    }
    this.#pageId = pageId;
    this.select([]);
    this.#notifyAll();
  }

  select(elementIds: readonly string[]): void {
    const next = [...new Set(elementIds)].filter((id) => this.getElement(id));
    if (
      next.length === this.#selection.length &&
      next.every((elementId, index) => elementId === this.#selection[index])
    ) {
      return;
    }
    this.#selection = next;
    for (const listener of this.#selectionListeners) {
      listener();
    }
  }

  commit(operations: readonly Operation[], options: CommitOptions = {}): EditorCommitResult {
    options.signal?.throwIfAborted();
    const prior = options.commandId
      ? this.#projection.history.find((entry) => entry.command.commandId === options.commandId)
      : undefined;
    if (prior) {
      if (this.getInteractionLocked() && !this.#commitCompletions.has(prior.command.commandId)) {
        const message = "Wait for the current edit to finish saving.";
        this.#onError?.(message);
        return {
          ok: false,
          projection: this.#projection,
          error: { ok: false, code: "INTERACTION_LOCKED", message },
        };
      }
      return applyCommand(this.#projection, {
        ...prior.command,
        origin: options.origin ?? "human",
        operations: [...operations],
      });
    }
    if (this.getInteractionLocked()) {
      const message = "Wait for the current edit to finish saving.";
      this.#onError?.(message);
      return {
        ok: false,
        projection: this.#projection,
        error: { ok: false, code: "INTERACTION_LOCKED", message },
      };
    }
    const command: Command = {
      documentId: this.#projection.document.id,
      commandId: options.commandId ?? this.createId("command"),
      clientId: this.clientId,
      clientSeq: this.#clientSeq + 1,
      baseCursor: this.#projection.cursor,
      origin: options.origin ?? "human",
      operations: [...operations],
    };
    const result = applyCommand(this.#projection, command);
    if (!result.ok) {
      this.#onError?.(result.error.message);
      return result;
    }

    options.signal?.throwIfAborted();
    this.#projection = result.projection;
    this.#rebuildIndexes();
    this.#clientSeq = command.clientSeq;
    this.#notify(result.receipt.changedIds);
    this.#publishCommit(this.#projection, command);
    return result;
  }

  async commitDurably(
    operations: readonly Operation[],
    options: CommitOptions = {},
  ): Promise<EditorCommitResult> {
    const result = this.commit(operations, options);
    if (!result.ok) return result;

    let completion = this.#commitCompletions.get(result.receipt.commandId);
    if (!completion && result.replayed) {
      const original = this.#projection.history.find(
        (entry) => entry.command.commandId === result.receipt.commandId,
      )?.command;
      if (original) {
        this.#publishCommit(this.#projection, original);
        completion = this.#commitCompletions.get(result.receipt.commandId);
      }
    }
    if (completion) await completion;
    const receipt =
      ownRecordValue(this.#projection.receipts, result.receipt.commandId) ?? result.receipt;
    return { ...result, projection: this.#projection, receipt };
  }

  createElement(
    pageId: string,
    element: Extract<Operation, { type: "create" }>["element"],
    options?: CommitOptions,
  ): EditorCommitResult {
    return this.commit([{ type: "create", pageId, element }], options);
  }
  /** Replace the Document's design profile record; `{}` returns it to Astryx's defaults. */
  setDesignProfile(
    tokens: Extract<Operation, { type: "design" }>["tokens"],
    options?: CommitOptions,
  ): EditorCommitResult {
    return this.commit([{ type: "design", tokens }], options);
  }

  patchElement(
    pageId: string,
    elementId: string,
    changes: Extract<Operation, { type: "patch" }>["changes"],
    options?: CommitOptions,
  ): EditorCommitResult {
    const element = this.getElement(elementId);
    if (!element) {
      return this.commit(
        [{ type: "patch", pageId, elementId, expectedVersion: 1, changes }],
        options,
      );
    }
    return this.commit(
      [{ type: "patch", pageId, elementId, expectedVersion: element.version, changes }],
      options,
    );
  }

  deleteSelection(options?: CommitOptions): EditorCommitResult | undefined {
    const page = this.getActivePage();
    if (!page || this.#selection.length === 0) {
      return undefined;
    }
    const selected = new Set(this.#selection);
    const byId = new Map(page.elements.map((element) => [element.id, element]));
    const childrenByParent = new Map<string, string[]>();
    const connectorsByEndpoint = new Map<string, string[]>();
    for (const element of page.elements) {
      if (element.parentId) {
        const children = childrenByParent.get(element.parentId) ?? [];
        children.push(element.id);
        childrenByParent.set(element.parentId, children);
      }
      if (element.kind === "connector") {
        for (const endpoint of [
          element.properties.from.elementId,
          element.properties.to.elementId,
        ]) {
          const connectors = connectorsByEndpoint.get(endpoint) ?? [];
          connectors.push(element.id);
          connectorsByEndpoint.set(endpoint, connectors);
        }
      }
    }

    const queue = [...selected];
    for (let index = 0; index < queue.length; index += 1) {
      const elementId = queue[index]!;
      for (const dependentId of [
        ...(childrenByParent.get(elementId) ?? []),
        ...(connectorsByEndpoint.get(elementId) ?? []),
      ]) {
        if (!selected.has(dependentId)) {
          selected.add(dependentId);
          queue.push(dependentId);
          if (selected.size > MAX_OPERATIONS_PER_COMMAND) {
            this.#onError?.(
              `Delete would affect more than ${MAX_OPERATIONS_PER_COMMAND} Elements. Delete smaller groups to keep the change atomic.`,
            );
            return undefined;
          }
        }
      }
    }

    const depth = (element: KoiElement): number => {
      let value = 0;
      let current = element;
      while (current.parentId && selected.has(current.parentId)) {
        const parent = byId.get(current.parentId);
        if (!parent) break;
        value += 1;
        current = parent;
      }
      return value;
    };
    const targets = page.elements
      .filter((element) => selected.has(element.id))
      .sort((left, right) => {
        if (left.kind === "connector" && right.kind !== "connector") return -1;
        if (right.kind === "connector" && left.kind !== "connector") return 1;
        return depth(right) - depth(left);
      });
    const operations: Operation[] = targets.map((element) => ({
      type: "delete",
      pageId: page.id,
      elementId: element.id,
      expectedVersion: element.version,
    }));
    const result = this.commit(operations, options);
    if (result.ok) {
      this.select([]);
    } else {
      this.#onError?.(result.error.message);
    }
    return result;
  }

  undo(options: Omit<CommitOptions, "commandId"> = {}): EditorCommitResult | undefined {
    if (this.getInteractionLocked()) {
      const message = "Wait for the current edit to finish saving.";
      this.#onError?.(message);
      return {
        ok: false,
        projection: this.#projection,
        error: { ok: false, code: "INTERACTION_LOCKED", message },
      };
    }
    const compensatedCommandIds = new Set(
      this.#projection.history.flatMap((entry) =>
        entry.command.undoOf ? [entry.command.undoOf] : [],
      ),
    );
    const target = [...this.#projection.history]
      .reverse()
      .find(
        (entry) =>
          entry.command.undoOf === undefined && !compensatedCommandIds.has(entry.command.commandId),
      );
    if (!target) {
      return undefined;
    }
    const commandId = this.createId("undo");
    const undo = createUndoCommand(this.#projection, target.command.commandId, {
      commandId,
      clientId: this.clientId,
      clientSeq: this.#clientSeq + 1,
      origin: options.origin ?? "human",
    });
    if (!undo.ok) {
      return undefined;
    }
    options.signal?.throwIfAborted();
    const result = applyCommand(this.#projection, undo.command);
    if (result.ok) {
      this.#projection = result.projection;
      this.#rebuildIndexes();
      this.#clientSeq = undo.command.clientSeq;
      this.#notify(result.receipt.changedIds);
      this.#publishCommit(this.#projection, undo.command);
    }
    return result;
  }

  replaceProjection(projection: Projection): void {
    const preserveSelection = projection.document.id === this.#projection.document.id;
    this.#projection = projection;
    this.#rebuildIndexes();
    this.#pageId = projection.document.pages.some((page) => page.id === this.#pageId)
      ? this.#pageId
      : projection.document.pages[0]!.id;
    this.#clientSeq =
      ownRecordValue(projection.clientHeads, this.clientId)?.clientSeq ?? this.#clientSeq;
    this.select(preserveSelection ? this.#selection : []);
    this.#notifyAll();
  }

  #notify(changedIds: readonly string[]): void {
    for (const id of changedIds) {
      for (const listener of this.#elementListeners.get(id) ?? []) {
        listener();
      }
    }
    this.#notifyAll();
  }

  #rebuildIndexes(): void {
    this.#elementsById = new Map(
      this.#projection.document.pages.flatMap((page) =>
        page.elements.map((element) => [element.id, element] as const),
      ),
    );
    this.#assetsById = new Map(
      this.#projection.document.assets.map((asset) => [asset.id, asset] as const),
    );
  }

  #publishCommit(projection: Projection, command: Command): void {
    let completion: Promise<void>;
    try {
      completion = Promise.resolve(this.#onCommit?.(projection, command));
    } catch (error) {
      completion = Promise.reject(error);
    }
    this.#commitCompletions.set(command.commandId, completion);
    void completion
      .catch(() => undefined)
      .finally(() => {
        if (this.#commitCompletions.get(command.commandId) === completion) {
          this.#commitCompletions.delete(command.commandId);
        }
      });
  }

  #notifyAll(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
