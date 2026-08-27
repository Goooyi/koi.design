import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  applyCommand,
  createInitialProjection,
  projectionSchema,
  type Projection,
} from "@koi/core";
import {
  acknowledgeApplyResult,
  createDemoDocument,
  importRequestFingerprint,
  MAX_IMPORT_RECEIPTS,
  prepareDocumentImport,
  RepositoryBusyError,
  type ImportDocumentRequest,
  type ImportRepositoryResult,
  type KoiDocumentRepository,
  type RepositoryApplyResult,
} from "@koi/mcp";

export const KOI_MCP_DATA_FILE_ENV = "KOI_MCP_DATA_FILE";
export const DEFAULT_KOI_MCP_DATA_FILE = ".koi/mcp/projection.json";
export const MAX_PERSISTED_KOI_BYTES = 32_000_000;
export const DEFAULT_MAX_PENDING_KOI_MUTATIONS = 4;
export const DEFAULT_MAX_PENDING_KOI_READS = 4;

const READ_CHUNK_BYTES = 64 * 1024;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EBADF",
  "EINVAL",
  "EISDIR",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

/** The new file is visible, but its directory entry could not be proven durable. */
class AtomicRenameCommittedError extends Error {
  constructor(filePath: string, options: ErrorOptions) {
    super(`Koi committed ${filePath}, but could not sync its parent directory`, options);
    this.name = "AtomicRenameCommittedError";
  }
}

interface PersistedImportReceipt {
  commandId: string;
  fingerprint: string;
}

interface PersistedKoiProjection {
  schemaVersion: 1;
  projection: Projection;
  importReceipts: PersistedImportReceipt[];
}

export interface FileKoiDocumentRepositoryOptions {
  filePath: string;
  initialProjection?: Projection;
  /** May only tighten Koi's hard persisted-state limit. */
  maxBytes?: number;
  /** Counts both the active mutation and serialized mutations waiting behind it. */
  maxPendingMutations?: number;
  /** Counts both the active read and serialized reads waiting behind it. */
  maxPendingReads?: number;
}

export interface ResolveKoiMcpDataFileOptions {
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;

  const error = new Error("MCP request was cancelled", { cause: signal.reason });
  error.name = "AbortError";
  throw error;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
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

async function syncPendingDirectories(
  pendingDirectories: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  for (const directory of pendingDirectories) {
    throwIfAborted(signal);
    await syncDirectory(directory);
    pendingDirectories.delete(directory);
  }
  throwIfAborted(signal);
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

function validateMaxBytes(maxBytes: number | undefined): number {
  const resolvedMax = maxBytes ?? MAX_PERSISTED_KOI_BYTES;
  if (
    !Number.isSafeInteger(resolvedMax) ||
    resolvedMax <= 0 ||
    resolvedMax > MAX_PERSISTED_KOI_BYTES
  ) {
    throw new RangeError(
      `maxBytes must be a positive integer no greater than ${MAX_PERSISTED_KOI_BYTES}`,
    );
  }
  return resolvedMax;
}

function validateMaxPendingMutations(maxPendingMutations: number | undefined): number {
  const resolvedMax = maxPendingMutations ?? DEFAULT_MAX_PENDING_KOI_MUTATIONS;
  if (!Number.isSafeInteger(resolvedMax) || resolvedMax <= 0) {
    throw new RangeError("maxPendingMutations must be a positive integer");
  }
  return resolvedMax;
}

function validateMaxPendingReads(maxPendingReads: number | undefined): number {
  const resolvedMax = maxPendingReads ?? DEFAULT_MAX_PENDING_KOI_READS;
  if (!Number.isSafeInteger(resolvedMax) || resolvedMax <= 0) {
    throw new RangeError("maxPendingReads must be a positive integer");
  }
  return resolvedMax;
}

function parseImportReceipts(value: unknown): PersistedImportReceipt[] {
  if (!Array.isArray(value) || value.length > MAX_IMPORT_RECEIPTS) {
    throw new Error(`importReceipts must contain at most ${MAX_IMPORT_RECEIPTS} entries`);
  }

  const commandIds = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`importReceipts[${index}] must be an object`);
    }
    const { commandId, fingerprint } = entry as Record<string, unknown>;
    if (
      typeof commandId !== "string" ||
      commandId.length > 128 ||
      !STABLE_ID_PATTERN.test(commandId)
    ) {
      throw new Error(`importReceipts[${index}].commandId is invalid`);
    }
    if (typeof fingerprint !== "string" || !SHA_256_PATTERN.test(fingerprint)) {
      throw new Error(`importReceipts[${index}].fingerprint is invalid`);
    }
    if (commandIds.has(commandId)) {
      throw new Error(`importReceipts contains duplicate command id ${commandId}`);
    }
    commandIds.add(commandId);
    return { commandId, fingerprint };
  });
}

function parsePersistedState(json: string): PersistedKoiProjection {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error("Koi MCP data file is not valid JSON", { cause: error });
  }

  if (typeof value !== "object" || value === null) {
    throw new Error("Koi MCP data file must contain an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error("Koi MCP data file has an unsupported schemaVersion");
  }

  const projection = projectionSchema.safeParse(record.projection);
  if (!projection.success) {
    const issues = projection.error.issues
      .slice(0, 4)
      .map((issue) => issue.message)
      .join("; ");
    throw new Error(`Koi MCP data file contains an invalid Projection: ${issues}`);
  }

  return {
    schemaVersion: 1,
    projection: projection.data,
    importReceipts: parseImportReceipts(record.importReceipts),
  };
}

function serializePersistedState(state: PersistedKoiProjection, maxBytes: number): string {
  const json = JSON.stringify(state);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > maxBytes) {
    throw new RangeError(`Persisted Koi Projection would exceed ${maxBytes} bytes`);
  }
  return json;
}

async function readBoundedFile(
  filePath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(filePath, constants.O_RDONLY | noFollow);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error(`Koi MCP data path is not a regular file: ${filePath}`);
    }
    if (metadata.size > maxBytes) {
      throw new RangeError(`Koi MCP data file exceeds ${maxBytes} bytes`);
    }
    await handle.chmod(0o600);

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      throwIfAborted(signal);
      const remaining = maxBytes - totalBytes;
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, totalBytes);
      if (bytesRead === 0) break;

      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new RangeError(`Koi MCP data file exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function writeAtomicFile(
  filePath: string,
  contents: string,
  pendingDirectorySyncs: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await syncPendingDirectories(pendingDirectorySyncs, signal);
  const directory = dirname(filePath);
  const createdDirectory = await mkdir(directory, { recursive: true, mode: 0o700 });
  if (createdDirectory !== undefined) {
    rememberCreatedDirectoryParents(createdDirectory, directory, pendingDirectorySyncs);
    // Only harden a directory this process created; the configured parent may be shared.
    await chmod(directory, 0o700);
    await syncPendingDirectories(pendingDirectorySyncs, signal);
  }

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let committed = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    throwIfAborted(signal);
    await rename(temporaryPath, filePath);
    committed = true;
    pendingDirectorySyncs.add(directory);
    try {
      await syncPendingDirectories(pendingDirectorySyncs, signal);
    } catch (error) {
      throw new AtomicRenameCommittedError(filePath, { cause: error });
    }
  } finally {
    await handle?.close().catch(() => undefined);
    if (!committed) {
      await unlink(temporaryPath).catch((error: unknown) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
    }
  }
}

export function resolveKoiMcpDataFile(options: ResolveKoiMcpDataFileOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const configured = (options.env ?? process.env)[KOI_MCP_DATA_FILE_ENV]?.trim();
  return resolve(cwd, configured || DEFAULT_KOI_MCP_DATA_FILE);
}

/**
 * Single-process, durable repository for the local stdio MCP server.
 * Every mutation is serialized and committed as one bounded atomic file replacement.
 */
export class FileKoiDocumentRepository implements KoiDocumentRepository {
  readonly #filePath: string;
  readonly #initialProjection: Projection;
  readonly #maxBytes: number;
  readonly #maxPendingMutations: number;
  readonly #maxPendingReads: number;
  #state: PersistedKoiProjection | undefined;
  #operationTail: Promise<void> = Promise.resolve();
  #pendingMutations = 0;
  #pendingReads = 0;
  readonly #pendingDirectorySyncs = new Set<string>();

  constructor(options: FileKoiDocumentRepositoryOptions) {
    this.#filePath = resolve(options.filePath);
    this.#initialProjection = projectionSchema.parse(
      options.initialProjection ?? createInitialProjection(createDemoDocument()),
    );
    this.#maxBytes = validateMaxBytes(options.maxBytes);
    this.#maxPendingMutations = validateMaxPendingMutations(options.maxPendingMutations);
    this.#maxPendingReads = validateMaxPendingReads(options.maxPendingReads);
  }

  readProjection(signal?: AbortSignal): Promise<Projection> {
    const releaseAdmission = this.#tryAdmitRead();
    if (!releaseAdmission) {
      return Promise.reject(
        new RepositoryBusyError(
          `The local MCP read limit of ${this.#maxPendingReads} has been reached`,
        ),
      );
    }

    return this.#serialize<Projection>(async () => {
      throwIfAborted(signal);
      const state = await this.#load(signal);
      await this.#ensureDurable(signal);
      return structuredClone(state.projection);
    }).finally(releaseAdmission);
  }

  apply(input: unknown, signal?: AbortSignal): Promise<RepositoryApplyResult> {
    const releaseAdmission = this.#tryAdmitMutation();
    if (!releaseAdmission) {
      return Promise.resolve({
        ok: false,
        error: {
          ok: false,
          code: "SERVER_BUSY",
          message: `The local MCP mutation limit of ${this.#maxPendingMutations} has been reached`,
          retryable: true,
        },
      });
    }

    return this.#serialize<RepositoryApplyResult>(async () => {
      throwIfAborted(signal);
      const state = await this.#load(signal);
      await this.#ensureDurable(signal);
      const result = acknowledgeApplyResult(applyCommand(state.projection, input));
      throwIfAborted(signal);
      if (!result.ok || result.replayed) return structuredClone(result);

      const nextState: PersistedKoiProjection = {
        ...state,
        projection: result.projection,
      };
      let json: string;
      try {
        json = serializePersistedState(nextState, this.#maxBytes);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return {
          ok: false,
          projection: structuredClone(state.projection),
          error: {
            ok: false,
            code: "RESOURCE_LIMIT",
            message: error.message,
          },
        };
      }

      await this.#persistState(nextState, json, signal);
      return structuredClone(result);
    }).finally(releaseAdmission);
  }

  replaceDocument(
    request: ImportDocumentRequest,
    signal?: AbortSignal,
  ): Promise<ImportRepositoryResult> {
    const releaseAdmission = this.#tryAdmitMutation();
    if (!releaseAdmission) {
      return Promise.resolve({
        ok: false,
        code: "SERVER_BUSY",
        message: `The local MCP mutation limit of ${this.#maxPendingMutations} has been reached`,
        retryable: true,
      });
    }

    return this.#serialize<ImportRepositoryResult>(async () => {
      throwIfAborted(signal);
      const state = await this.#load(signal);
      await this.#ensureDurable(signal);
      const nextFingerprint = importRequestFingerprint(request);
      const priorReceipt = state.importReceipts.find(
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
        return { ok: true, projection: structuredClone(state.projection), replayed: true };
      }

      const prepared = prepareDocumentImport(state.projection, request);
      if (!prepared.ok) return prepared;
      throwIfAborted(signal);

      const importReceipts = [
        ...state.importReceipts,
        { commandId: request.commandId, fingerprint: nextFingerprint },
      ].slice(-MAX_IMPORT_RECEIPTS);
      const nextState: PersistedKoiProjection = {
        schemaVersion: 1,
        projection: prepared.projection,
        importReceipts,
      };
      let json: string;
      try {
        json = serializePersistedState(nextState, this.#maxBytes);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return {
          ok: false,
          code: "DOCUMENT_TOO_LARGE",
          message: error.message,
        };
      }

      await this.#persistState(nextState, json, signal);
      return { ok: true, projection: structuredClone(prepared.projection), replayed: false };
    }).finally(releaseAdmission);
  }

  async #load(signal?: AbortSignal): Promise<PersistedKoiProjection> {
    if (this.#state) return this.#state;

    try {
      const json = await readBoundedFile(this.#filePath, this.#maxBytes, signal);
      const state = parsePersistedState(json);
      this.#state = state;
      return state;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }

    const state: PersistedKoiProjection = {
      schemaVersion: 1,
      projection: structuredClone(this.#initialProjection),
      importReceipts: [],
    };
    const json = serializePersistedState(state, this.#maxBytes);
    await this.#persistState(state, json, signal);
    return state;
  }

  async #persistState(
    state: PersistedKoiProjection,
    json: string,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await writeAtomicFile(this.#filePath, json, this.#pendingDirectorySyncs, signal);
    } catch (error) {
      if (error instanceof AtomicRenameCommittedError) {
        this.#state = state;
      }
      throw error;
    }
    this.#state = state;
  }

  async #ensureDurable(signal?: AbortSignal): Promise<void> {
    await syncPendingDirectories(this.#pendingDirectorySyncs, signal);
  }

  async #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const previous = this.#operationTail;
    let release: (() => void) | undefined;
    this.#operationTail = new Promise<void>((resolveTail) => {
      release = resolveTail;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  #tryAdmitMutation(): (() => void) | undefined {
    if (this.#pendingMutations >= this.#maxPendingMutations) return undefined;

    this.#pendingMutations += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#pendingMutations -= 1;
    };
  }

  #tryAdmitRead(): (() => void) | undefined {
    if (this.#pendingReads >= this.#maxPendingReads) return undefined;

    this.#pendingReads += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#pendingReads -= 1;
    };
  }
}
