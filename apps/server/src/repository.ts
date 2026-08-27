import {
  applyCommand,
  createEmptyDocument,
  createInitialProjection,
  projectionSchema,
  stableIdSchema,
  type ApplyCommandResult,
  type Projection,
} from "@koi/core";
import {
  acknowledgeApplyResult,
  importRequestFingerprint,
  MAX_IMPORT_RECEIPTS,
  prepareDocumentImport,
  type ImportDocumentRequest,
  type ImportRepositoryResult,
} from "@koi/mcp";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

import { RepositoryError } from "./errors.js";
import { ReadAdmission } from "./read-admission.js";

const INDEX_SCHEMA_VERSION = 1;
const MAX_INDEX_BYTES = 1 * 1024 * 1024;

const documentReferenceSchema = z.strictObject({
  id: stableIdSchema,
  name: z.string().min(1).max(512),
});

const workspaceRecordSchema = z.strictObject({
  id: stableIdSchema,
  name: z.string().min(1).max(512),
  documents: z.array(documentReferenceSchema).max(64),
});

const importReceiptSchema = z.strictObject({
  commandId: stableIdSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

const storedDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projection: projectionSchema,
  importReceipts: z.array(importReceiptSchema).max(MAX_IMPORT_RECEIPTS),
});

type StoredDocument = z.infer<typeof storedDocumentSchema>;

const repositoryIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(INDEX_SCHEMA_VERSION),
    workspaces: z.array(workspaceRecordSchema).max(32),
  })
  .superRefine((index, context) => {
    const workspaceIds = new Set<string>();
    const documentIds = new Set<string>();
    for (const [workspaceIndex, workspace] of index.workspaces.entries()) {
      if (workspaceIds.has(workspace.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate Workspace id: ${workspace.id}`,
          path: ["workspaces", workspaceIndex, "id"],
        });
      }
      workspaceIds.add(workspace.id);
      for (const [documentIndex, document] of workspace.documents.entries()) {
        if (documentIds.has(document.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate Document id: ${document.id}`,
            path: ["workspaces", workspaceIndex, "documents", documentIndex, "id"],
          });
        }
        documentIds.add(document.id);
      }
    }
    if (documentIds.size > 128) {
      context.addIssue({
        code: "custom",
        message: "Repository contains more than 128 Documents",
        path: ["workspaces"],
      });
    }
  });

type RepositoryIndex = z.infer<typeof repositoryIndexSchema>;

export interface WorkspaceSummary {
  id: string;
  name: string;
  documentCount: number;
}

export interface DocumentSummary {
  id: string;
  workspaceId: string;
  name: string;
}

export interface CreateWorkspaceInput {
  id?: string;
  name: string;
}

export interface CreateDocumentInput {
  id?: string;
  pageId?: string;
  name: string;
}

export interface RepositoryLimits {
  maxWorkspaces: number;
  maxDocuments: number;
  maxDocumentsPerWorkspace: number;
  maxDocumentBytes: number;
  maxConcurrentReads: number;
  maxPendingWrites: number;
}

export const DEFAULT_REPOSITORY_LIMITS: Readonly<RepositoryLimits> = {
  maxWorkspaces: 32,
  maxDocuments: 128,
  maxDocumentsPerWorkspace: 64,
  maxDocumentBytes: 8 * 1024 * 1024,
  maxConcurrentReads: 2,
  maxPendingWrites: 128,
};

export type StoredCommandResult = ApplyCommandResult;

export interface KoiRepository {
  initialize(): Promise<void>;
  isReady(): boolean;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  getWorkspace(workspaceId: string): Promise<WorkspaceSummary>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceSummary>;
  listDocuments(workspaceId: string): Promise<DocumentSummary[]>;
  createDocument(workspaceId: string, input: CreateDocumentInput): Promise<Projection>;
  getProjection(documentId: string): Promise<Projection>;
  submitCommand(documentId: string, input: unknown): Promise<StoredCommandResult>;
  replaceDocument(
    documentId: string,
    request: ImportDocumentRequest,
  ): Promise<ImportRepositoryResult>;
}

function generatedId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function cloneSummary(workspace: RepositoryIndex["workspaces"][number]): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    documentCount: workspace.documents.length,
  };
}

function findDocument(
  index: RepositoryIndex,
  documentId: string,
): { workspace: RepositoryIndex["workspaces"][number]; document: DocumentSummary } | undefined {
  for (const workspace of index.workspaces) {
    const document = workspace.documents.find((candidate) => candidate.id === documentId);
    if (document) {
      return {
        workspace,
        document: { ...document, workspaceId: workspace.id },
      };
    }
  }
  return undefined;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EBADF",
  "EINVAL",
  "EISDIR",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

/** The replacement is visible, but its directory entry could not be proven durable. */
class AtomicRenameCommittedError extends Error {
  constructor(filePath: string, options: ErrorOptions) {
    super(`Koi committed ${filePath}, but could not sync its parent directory`, options);
    this.name = "AtomicRenameCommittedError";
  }
}

async function syncDirectory(directory: string): Promise<void> {
  // Node cannot portably open directory handles for fsync on Windows.
  if (process.platform === "win32") {
    return;
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Some POSIX and network filesystems expose directory handles but reject directory fsync.
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        UNSUPPORTED_DIRECTORY_SYNC_CODES.has(error.code)
      )
    ) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

function rememberCreatedDirectoryParents(
  firstCreatedDirectory: string,
  targetDirectory: string,
  pendingDirectories: Set<string>,
): void {
  const target = resolve(targetDirectory);
  let parent = dirname(resolve(firstCreatedDirectory));
  const pathFromParent = relative(parent, target);
  const segments = pathFromParent.split(sep).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    throw new Error(`Created directory ${firstCreatedDirectory} is outside ${targetDirectory}`);
  }

  for (const segment of segments) {
    pendingDirectories.add(parent);
    parent = join(parent, segment);
  }
  if (parent !== target) {
    throw new Error(`Created directory ${firstCreatedDirectory} is outside ${targetDirectory}`);
  }
}

export class FileKoiRepository implements KoiRepository {
  readonly #rootDirectory: string;
  readonly #documentsDirectory: string;
  readonly #indexPath: string;
  readonly #limits: Readonly<RepositoryLimits>;
  readonly #readAdmission: ReadAdmission;
  #index: RepositoryIndex | undefined;
  #writeTail: Promise<void> = Promise.resolve();
  #pendingWrites = 0;
  readonly #pendingDirectorySyncs = new Set<string>();
  readonly #directorySyncRetries = new Map<string, Promise<void>>();

  constructor(rootDirectory: string, limits: Partial<RepositoryLimits> = {}) {
    this.#rootDirectory = resolve(rootDirectory);
    this.#documentsDirectory = join(this.#rootDirectory, "documents");
    this.#indexPath = join(this.#rootDirectory, "index.json");
    this.#limits = { ...DEFAULT_REPOSITORY_LIMITS, ...limits };

    for (const [name, value] of Object.entries(this.#limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`Repository limit ${name} must be a positive integer`);
      }
    }
    this.#readAdmission = new ReadAdmission(this.#limits.maxConcurrentReads);
  }

  async initialize(): Promise<void> {
    await this.#withWrite(async () => {
      if (this.#index) {
        return;
      }

      await this.#ensureDirectory(this.#documentsDirectory);
      try {
        const source = await this.#readBoundedFile(this.#indexPath, MAX_INDEX_BYTES);
        const index = repositoryIndexSchema.parse(JSON.parse(source) as unknown);
        this.#assertIndexWithinLimits(index);
        this.#index = index;
      } catch (error) {
        if (!isMissingFile(error)) {
          throw new RepositoryError(
            "CORRUPT_DATA",
            "The repository index cannot be read or validated",
            { cause: error },
          );
        }

        const index: RepositoryIndex = { schemaVersion: INDEX_SCHEMA_VERSION, workspaces: [] };
        await this.#writeJson(this.#indexPath, index, MAX_INDEX_BYTES);
        this.#index = index;
      }
    });
  }

  isReady(): boolean {
    return this.#index !== undefined;
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.#withAuthoritativeRead(() => this.#requireIndex().workspaces.map(cloneSummary));
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
    return this.#withAuthoritativeRead(() => {
      const workspace = this.#requireIndex().workspaces.find(
        (candidate) => candidate.id === workspaceId,
      );
      if (!workspace) {
        throw new RepositoryError("NOT_FOUND", `Workspace ${workspaceId} does not exist`);
      }
      return cloneSummary(workspace);
    });
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceSummary> {
    return this.#withWrite(async () => {
      const index = this.#requireIndex();
      const id = stableIdSchema.parse(input.id ?? generatedId("workspace"));

      if (index.workspaces.some((workspace) => workspace.id === id)) {
        throw new RepositoryError("CONFLICT", `Workspace ${id} already exists`);
      }
      if (index.workspaces.length >= this.#limits.maxWorkspaces) {
        throw new RepositoryError("CAPACITY_EXCEEDED", "Workspace capacity has been reached");
      }

      const workspace = workspaceRecordSchema.parse({ id, name: input.name, documents: [] });
      const nextIndex = { ...index, workspaces: [...index.workspaces, workspace] };
      await this.#persistIndex(nextIndex);
      return cloneSummary(workspace);
    });
  }

  async listDocuments(workspaceId: string): Promise<DocumentSummary[]> {
    return this.#withAuthoritativeRead(() => {
      const workspace = this.#requireIndex().workspaces.find(
        (candidate) => candidate.id === workspaceId,
      );
      if (!workspace) {
        throw new RepositoryError("NOT_FOUND", `Workspace ${workspaceId} does not exist`);
      }
      return workspace.documents.map((document) => ({ ...document, workspaceId }));
    });
  }

  async createDocument(workspaceId: string, input: CreateDocumentInput): Promise<Projection> {
    return this.#withWrite(async () => {
      const index = this.#requireIndex();
      const workspaceIndex = index.workspaces.findIndex(
        (candidate) => candidate.id === workspaceId,
      );
      if (workspaceIndex === -1) {
        throw new RepositoryError("NOT_FOUND", `Workspace ${workspaceId} does not exist`);
      }

      const workspace = index.workspaces[workspaceIndex]!;
      const totalDocuments = index.workspaces.reduce(
        (total, candidate) => total + candidate.documents.length,
        0,
      );
      if (
        totalDocuments >= this.#limits.maxDocuments ||
        workspace.documents.length >= this.#limits.maxDocumentsPerWorkspace
      ) {
        throw new RepositoryError("CAPACITY_EXCEEDED", "Document capacity has been reached");
      }

      const id = stableIdSchema.parse(input.id ?? generatedId("document"));
      if (findDocument(index, id)) {
        throw new RepositoryError("CONFLICT", `Document ${id} already exists`);
      }

      const document = createEmptyDocument({
        id,
        workspaceId,
        name: input.name,
        pageId: stableIdSchema.parse(input.pageId ?? generatedId("page")),
        historyId: generatedId("history"),
        designProfileVersion: "0.5.0",
      });
      const projection = createInitialProjection(document);
      await this.#writeStoredDocument({
        schemaVersion: 1,
        projection,
        importReceipts: [],
      });

      const nextWorkspace = {
        ...workspace,
        documents: [...workspace.documents, { id: document.id, name: document.name }],
      };
      const workspaces = index.workspaces.slice();
      workspaces[workspaceIndex] = nextWorkspace;
      await this.#persistIndex({ ...index, workspaces });
      return projection;
    });
  }

  async getProjection(documentId: string): Promise<Projection> {
    return this.#withAuthoritativeRead(async () => {
      return (await this.#readStoredDocument(documentId)).projection;
    });
  }

  async submitCommand(documentId: string, input: unknown): Promise<StoredCommandResult> {
    return this.#withWrite(async () => {
      const stored = await this.#readStoredDocument(documentId);
      const result = acknowledgeApplyResult(applyCommand(stored.projection, input));
      if (!result.ok || result.replayed) {
        return result;
      }
      await this.#writeStoredDocument({ ...stored, projection: result.projection });
      return result;
    });
  }

  async replaceDocument(
    documentId: string,
    request: ImportDocumentRequest,
  ): Promise<ImportRepositoryResult> {
    return this.#withWrite(async () => {
      const stored = await this.#readStoredDocument(documentId);
      const nextFingerprint = importRequestFingerprint(request);
      const priorReceipt = stored.importReceipts.find(
        (receipt) => receipt.commandId === request.commandId,
      );
      if (priorReceipt) {
        if (priorReceipt.fingerprint !== nextFingerprint) {
          return {
            ok: false,
            code: "DUPLICATE_IMPORT_ID",
            message: `Import command id ${request.commandId} was already used for different content`,
          };
        }
        await this.#updateDocumentName(documentId, stored.projection.document.name);
        return { ok: true, projection: stored.projection, replayed: true };
      }

      const prepared = prepareDocumentImport(stored.projection, request);
      if (!prepared.ok) {
        return prepared;
      }

      const importReceipts = [
        ...stored.importReceipts,
        { commandId: request.commandId, fingerprint: nextFingerprint },
      ].slice(-MAX_IMPORT_RECEIPTS);
      await this.#writeStoredDocument({
        schemaVersion: 1,
        projection: prepared.projection,
        importReceipts,
      });
      await this.#updateDocumentName(documentId, prepared.projection.document.name);
      return { ok: true, projection: prepared.projection, replayed: false };
    });
  }

  #requireIndex(): RepositoryIndex {
    if (!this.#index) {
      throw new Error("Repository must be initialized before use");
    }
    return this.#index;
  }

  #documentPath(documentId: string): string {
    const filename = Buffer.from(documentId, "utf8").toString("base64url");
    return join(this.#documentsDirectory, `${filename}.json`);
  }

  async #persistIndex(index: RepositoryIndex): Promise<void> {
    const parsed = repositoryIndexSchema.parse(index);
    this.#assertIndexWithinLimits(parsed);
    try {
      await this.#writeJson(this.#indexPath, parsed, MAX_INDEX_BYTES);
    } catch (error) {
      if (error instanceof AtomicRenameCommittedError) {
        this.#index = parsed;
      }
      throw error;
    }
    this.#index = parsed;
  }

  async #updateDocumentName(documentId: string, name: string): Promise<void> {
    const index = this.#requireIndex();
    const workspaceIndex = index.workspaces.findIndex((workspace) =>
      workspace.documents.some((document) => document.id === documentId),
    );
    if (workspaceIndex === -1) {
      throw new RepositoryError("NOT_FOUND", `Document ${documentId} does not exist`);
    }
    const workspace = index.workspaces[workspaceIndex]!;
    const documents = workspace.documents.map((document) =>
      document.id === documentId ? { ...document, name } : document,
    );
    const workspaces = index.workspaces.slice();
    workspaces[workspaceIndex] = { ...workspace, documents };
    await this.#persistIndex({ ...index, workspaces });
  }

  #assertIndexWithinLimits(index: RepositoryIndex): void {
    const documentCount = index.workspaces.reduce(
      (total, workspace) => total + workspace.documents.length,
      0,
    );
    if (
      index.workspaces.length > this.#limits.maxWorkspaces ||
      documentCount > this.#limits.maxDocuments ||
      index.workspaces.some(
        (workspace) => workspace.documents.length > this.#limits.maxDocumentsPerWorkspace,
      )
    ) {
      throw new RepositoryError(
        "CAPACITY_EXCEEDED",
        "Stored repository metadata exceeds the configured capacity",
      );
    }
  }

  async #readStoredDocument(documentId: string): Promise<StoredDocument> {
    const index = this.#requireIndex();
    const reference = findDocument(index, documentId);
    if (!reference) {
      throw new RepositoryError("NOT_FOUND", `Document ${documentId} does not exist`);
    }

    return this.#readAdmission.run(async () => {
      try {
        const source = await this.#readBoundedFile(
          this.#documentPath(documentId),
          this.#limits.maxDocumentBytes,
        );
        const stored = storedDocumentSchema.parse(JSON.parse(source) as unknown);
        if (
          stored.projection.document.id !== documentId ||
          stored.projection.document.workspaceId !== reference.workspace.id
        ) {
          throw new Error("Document identity does not match its repository entry");
        }
        return stored;
      } catch (error) {
        if (error instanceof RepositoryError) {
          throw error;
        }
        throw new RepositoryError(
          "CORRUPT_DATA",
          `Document ${documentId} cannot be read or validated`,
          { cause: error },
        );
      }
    });
  }

  async #writeStoredDocument(stored: StoredDocument): Promise<void> {
    await this.#writeJson(
      this.#documentPath(stored.projection.document.id),
      storedDocumentSchema.parse(stored),
      this.#limits.maxDocumentBytes,
    );
  }

  async #readBoundedFile(path: string, maxBytes: number): Promise<string> {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > maxBytes) {
      throw new RepositoryError("CORRUPT_DATA", "A repository file exceeds its safe bound");
    }
    return readFile(path, "utf8");
  }

  async #writeJson(path: string, value: unknown, maxBytes: number): Promise<void> {
    const source = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(source) > maxBytes) {
      throw new RepositoryError(
        "CAPACITY_EXCEEDED",
        "The document exceeds the configured storage bound",
      );
    }

    const directory = dirname(path);
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(source, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, path);
      try {
        await syncDirectory(directory);
        this.#pendingDirectorySyncs.delete(directory);
      } catch (error) {
        this.#pendingDirectorySyncs.add(directory);
        throw new AtomicRenameCommittedError(path, { cause: error });
      }
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async #ensureDirectory(directory: string): Promise<void> {
    const firstCreatedDirectory = await mkdir(directory, { recursive: true, mode: 0o700 });
    if (firstCreatedDirectory === undefined) return;

    rememberCreatedDirectoryParents(firstCreatedDirectory, directory, this.#pendingDirectorySyncs);
    await this.#ensureDurable();
  }

  #withWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#pendingWrites >= this.#limits.maxPendingWrites) {
      return Promise.reject(
        new RepositoryError("SERVER_BUSY", "The repository write queue is full"),
      );
    }

    this.#pendingWrites += 1;
    const guardedOperation = async () => {
      await this.#ensureDurable();
      const result = await operation();
      await this.#ensureDurable();
      return result;
    };
    const result = this.#writeTail.then(guardedOperation, guardedOperation);
    this.#writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.#pendingWrites -= 1;
    });
  }

  async #withAuthoritativeRead<T>(operation: () => T | Promise<T>): Promise<T> {
    while (true) {
      const observedWriteTail = this.#writeTail;
      await observedWriteTail;
      await this.#ensureDurable();
      const result = await operation();
      await this.#ensureDurable();
      if (this.#writeTail === observedWriteTail) {
        return result;
      }
    }
  }

  async #ensureDurable(): Promise<void> {
    for (const directory of [...this.#pendingDirectorySyncs].sort()) {
      let retry = this.#directorySyncRetries.get(directory);
      if (!retry) {
        retry = syncDirectory(directory)
          .then(() => {
            this.#pendingDirectorySyncs.delete(directory);
          })
          .finally(() => {
            this.#directorySyncRetries.delete(directory);
          });
        this.#directorySyncRetries.set(directory, retry);
      }
      await retry;
    }
  }
}
