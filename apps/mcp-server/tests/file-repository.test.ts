import {
  chmod,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { getElement, type Command } from "@koi/core";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_KOI_MCP_DATA_FILE,
  FileKoiDocumentRepository,
  KOI_MCP_DATA_FILE_ENV,
  resolveKoiMcpDataFile,
} from "../src/file-repository.js";

const temporaryDirectories: string[] = [];

async function temporaryDataFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "koi-mcp-repository-"));
  temporaryDirectories.push(directory);
  return join(directory, "nested", "projection.json");
}

function patchGeometry(
  commandId: string,
  clientId: string,
  elementId: string,
  changes: { x?: number; y?: number },
): Command {
  return {
    documentId: "document-demo",
    commandId,
    clientId,
    clientSeq: 1,
    baseCursor: 0,
    origin: clientId.startsWith("agent") ? "agent" : "human",
    operations: [
      {
        type: "patch",
        pageId: "page-explorations",
        elementId,
        expectedVersion: 1,
        changes: { geometry: changes },
      },
    ],
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("file-backed MCP repository", () => {
  it("syncs a newly created data-directory entry before reporting the first state durable", async () => {
    const filePath = await temporaryDataFile();
    const probe = await open(dirname(dirname(filePath)), "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();

    try {
      const repository = new FileKoiDocumentRepository({ filePath });
      await repository.readProjection();
      expect(syncSpy).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 3);
    } finally {
      syncSpy.mockRestore();
    }
  });

  it("withholds first state until a newly created data-directory entry is durable", async () => {
    if (process.platform === "win32") return;

    const filePath = await temporaryDataFile();
    const probe = await open(dirname(dirname(filePath)), "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();
    syncSpy
      .mockRejectedValueOnce(new Error("directory entry sync failed"))
      .mockRejectedValueOnce(new Error("directory entry sync still failed"));

    const repository = new FileKoiDocumentRepository({ filePath });
    await expect(repository.readProjection()).rejects.toThrow("directory entry sync failed");
    await expect(repository.readProjection()).rejects.toThrow("directory entry sync still failed");
    syncSpy.mockRestore();

    await expect(repository.readProjection()).resolves.toMatchObject({
      document: { id: "document-demo" },
    });
    const restarted = new FileKoiDocumentRepository({ filePath });
    await expect(restarted.readProjection()).resolves.toMatchObject({
      document: { id: "document-demo" },
    });
  });

  it("syncs the parent directory after atomically creating repository state", async () => {
    const filePath = await temporaryDataFile();
    await mkdir(dirname(filePath), { recursive: true });
    const probe = await open(dirname(filePath), "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();

    try {
      const repository = new FileKoiDocumentRepository({ filePath });
      await repository.readProjection();
      expect(syncSpy).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 2);
    } finally {
      syncSpy.mockRestore();
    }
  });

  it("serializes concurrent Commands and preserves their idempotency after restart", async () => {
    const filePath = await temporaryDataFile();
    const repository = new FileKoiDocumentRepository({ filePath });
    await repository.readProjection();

    const moveFrame = patchGeometry("move-frame", "human-test", "frame-welcome", { x: 360 });
    const moveNote = patchGeometry("move-note", "agent-test", "note-agent", { y: 440 });
    const [frameResult, noteResult] = await Promise.all([
      repository.apply(moveFrame),
      repository.apply(moveNote),
    ]);
    expect(frameResult).toMatchObject({
      ok: true,
      replayed: false,
      receipt: { syncStatus: "acknowledged" },
    });
    expect(noteResult).toMatchObject({
      ok: true,
      replayed: false,
      receipt: { syncStatus: "acknowledged" },
    });

    const restarted = new FileKoiDocumentRepository({ filePath });
    const persisted = await restarted.readProjection();
    expect(persisted.document.revision).toBe(2);
    expect(persisted.history).toHaveLength(2);
    expect(persisted.outbox).toEqual([]);
    expect(getElement(persisted.document, "frame-welcome")?.geometry.x).toBe(360);
    expect(getElement(persisted.document, "note-agent")?.geometry.y).toBe(440);

    await expect(restarted.apply(moveFrame)).resolves.toMatchObject({
      ok: true,
      replayed: true,
    });
    expect((await restarted.readProjection()).history).toHaveLength(2);

    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(filePath))).mode & 0o777).toBe(0o700);
    expect(await readdir(dirname(filePath))).toEqual(["projection.json"]);
  });

  it("withholds a renamed Command until an exact retry confirms directory durability", async () => {
    if (process.platform === "win32") return;

    const filePath = await temporaryDataFile();
    const repository = new FileKoiDocumentRepository({ filePath });
    await repository.readProjection();
    const probe = await open(dirname(filePath), "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();
    syncSpy
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("directory sync failed"))
      .mockRejectedValueOnce(new Error("directory sync still failed"))
      .mockRejectedValueOnce(new Error("directory sync failed"));

    const first = patchGeometry("move-before-sync-failure", "human-sync", "frame-welcome", {
      x: 410,
    });
    await expect(repository.apply(first)).rejects.toThrow("could not sync its parent directory");
    await expect(repository.readProjection()).rejects.toThrow("directory sync still failed");
    await expect(repository.apply(first)).rejects.toThrow("directory sync failed");
    syncSpy.mockRestore();

    await expect(repository.apply(first)).resolves.toMatchObject({ ok: true, replayed: true });

    const restarted = new FileKoiDocumentRepository({ filePath });
    const persisted = await restarted.readProjection();
    expect(persisted.history.map((entry) => entry.command.commandId)).toEqual([first.commandId]);
    expect(getElement(persisted.document, "frame-welcome")?.geometry.x).toBe(410);
  });

  it("withholds a renamed import until an exact retry confirms directory durability", async () => {
    if (process.platform === "win32") return;

    const filePath = await temporaryDataFile();
    const repository = new FileKoiDocumentRepository({ filePath });
    const projection = await repository.readProjection();
    const request = {
      commandId: "import-before-sync-failure",
      expectedDocumentId: projection.document.id,
      expectedRevision: projection.document.revision,
      documentJson: JSON.stringify({
        ...projection.document,
        name: "Imported before sync failure",
      }),
    };
    const probe = await open(dirname(filePath), "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();
    syncSpy
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("directory sync failed"))
      .mockRejectedValueOnce(new Error("directory sync still failed"))
      .mockRejectedValueOnce(new Error("directory sync failed"));

    await expect(repository.replaceDocument(request)).rejects.toThrow(
      "could not sync its parent directory",
    );
    await expect(repository.readProjection()).rejects.toThrow("directory sync still failed");
    await expect(repository.replaceDocument(request)).rejects.toThrow("directory sync failed");
    syncSpy.mockRestore();

    await expect(repository.replaceDocument(request)).resolves.toMatchObject({
      ok: true,
      replayed: true,
    });

    const restarted = new FileKoiDocumentRepository({ filePath });
    expect((await restarted.readProjection()).document.name).toBe("Imported before sync failure");
  });

  it("preserves import receipts and imported content after restart", async () => {
    const filePath = await temporaryDataFile();
    const repository = new FileKoiDocumentRepository({ filePath });
    const projection = await repository.readProjection();
    const documentJson = JSON.stringify({
      ...projection.document,
      name: "Persistent imported study",
    });
    const request = {
      commandId: "import-persistent-study",
      expectedDocumentId: projection.document.id,
      expectedRevision: projection.document.revision,
      documentJson,
    };

    await expect(repository.replaceDocument(request)).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });

    const restarted = new FileKoiDocumentRepository({ filePath });
    await expect(restarted.replaceDocument(request)).resolves.toMatchObject({
      ok: true,
      replayed: true,
    });
    expect((await restarted.readProjection()).document.name).toBe("Persistent imported study");

    await expect(
      restarted.replaceDocument({
        ...request,
        documentJson: documentJson.replace("Persistent imported study", "Different study"),
      }),
    ).resolves.toMatchObject({ ok: false, code: "DUPLICATE_IMPORT_ID" });
  });

  it("does not change permissions on a pre-existing configured parent directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "koi-mcp-existing-parent-"));
    temporaryDirectories.push(directory);
    await chmod(directory, 0o755);
    const filePath = join(directory, "projection.json");

    const repository = new FileKoiDocumentRepository({ filePath });
    await repository.readProjection();

    expect((await stat(directory)).mode & 0o777).toBe(0o755);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(["projection.json"]);
  });

  it("rejects oversized and invalid files instead of resetting user data", async () => {
    const filePath = await temporaryDataFile();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "x".repeat(513));

    const oversized = new FileKoiDocumentRepository({ filePath, maxBytes: 512 });
    await expect(oversized.readProjection()).rejects.toThrow("exceeds 512 bytes");

    await writeFile(
      filePath,
      JSON.stringify({ schemaVersion: 1, projection: {}, importReceipts: [] }),
    );
    const invalid = new FileKoiDocumentRepository({ filePath, maxBytes: 512 });
    await expect(invalid.readProjection()).rejects.toThrow("invalid Projection");
  });

  it("rejects a mutation that would cross the configured bounded-file limit", async () => {
    const filePath = await temporaryDataFile();
    const repository = new FileKoiDocumentRepository({ filePath });
    await repository.readProjection();
    const initialBytes = (await stat(filePath)).size;
    const bounded = new FileKoiDocumentRepository({
      filePath,
      maxBytes: initialBytes + 100,
    });

    const result = await bounded.apply(
      patchGeometry("move-too-large", "human-bounds", "frame-welcome", { x: 720 }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "RESOURCE_LIMIT" } });

    const persistedJson = await readFile(filePath, "utf8");
    expect(Buffer.byteLength(persistedJson, "utf8")).toBe(initialBytes);
    const restarted = new FileKoiDocumentRepository({ filePath });
    expect((await restarted.readProjection()).document.revision).toBe(0);
  });

  it("fails excess apply and import mutations fast, then accepts exact retries", async () => {
    const filePath = await temporaryDataFile();
    const repository = new FileKoiDocumentRepository({ filePath, maxPendingMutations: 1 });
    const initial = await repository.readProjection();
    const firstCommand = patchGeometry(
      "admission-apply-first",
      "human-admission",
      "frame-welcome",
      {
        x: 480,
      },
    );
    const importAfterFirstCommand = {
      commandId: "admission-import-retry",
      expectedDocumentId: initial.document.id,
      expectedRevision: 1,
      documentJson: JSON.stringify({ ...initial.document, name: "Admission import one" }),
    };

    const pendingApply = repository.apply(firstCommand);
    await expect(repository.replaceDocument(importAfterFirstCommand)).resolves.toMatchObject({
      ok: false,
      code: "SERVER_BUSY",
      retryable: true,
    });
    await expect(pendingApply).resolves.toMatchObject({ ok: true });
    await expect(repository.replaceDocument(importAfterFirstCommand)).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });

    const afterFirstImport = await repository.readProjection();
    const secondImport = {
      commandId: "admission-import-first",
      expectedDocumentId: afterFirstImport.document.id,
      expectedRevision: afterFirstImport.document.revision,
      documentJson: JSON.stringify({
        ...afterFirstImport.document,
        name: "Admission import two",
      }),
    };
    const commandAfterSecondImport: Command = {
      ...patchGeometry("admission-apply-retry", "agent-admission", "note-agent", { y: 520 }),
      baseCursor: afterFirstImport.cursor + 1,
    };

    const pendingImport = repository.replaceDocument(secondImport);
    await expect(repository.apply(commandAfterSecondImport)).resolves.toMatchObject({
      ok: false,
      error: { code: "SERVER_BUSY", retryable: true },
    });
    await expect(pendingImport).resolves.toMatchObject({ ok: true });
    await expect(repository.apply(commandAfterSecondImport)).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });
  });

  it("bounds active and queued Projection reads, then releases admission", async () => {
    const filePath = await temporaryDataFile();
    const repository = new FileKoiDocumentRepository({ filePath, maxPendingReads: 2 });

    const first = repository.readProjection();
    const second = repository.readProjection();
    await expect(repository.readProjection()).rejects.toMatchObject({
      name: "RepositoryBusyError",
      code: "SERVER_BUSY",
      retryable: true,
    });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await expect(repository.readProjection()).resolves.toMatchObject({
      document: { id: "document-demo" },
    });
  });

  it("requires positive admission limits", async () => {
    const filePath = await temporaryDataFile();
    expect(() => new FileKoiDocumentRepository({ filePath, maxPendingMutations: 0 })).toThrow(
      "maxPendingMutations must be a positive integer",
    );
    expect(() => new FileKoiDocumentRepository({ filePath, maxPendingReads: 0 })).toThrow(
      "maxPendingReads must be a positive integer",
    );
  });

  it("resolves the environment override relative to the server working directory", () => {
    expect(resolveKoiMcpDataFile({ cwd: "/workspace", env: {} })).toBe(
      resolve("/workspace", DEFAULT_KOI_MCP_DATA_FILE),
    );
    expect(
      resolveKoiMcpDataFile({
        cwd: "/workspace",
        env: { [KOI_MCP_DATA_FILE_ENV]: "state/koi.json" },
      }),
    ).toBe(resolve("/workspace", "state/koi.json"));
    expect(
      resolveKoiMcpDataFile({
        cwd: "/workspace",
        env: { [KOI_MCP_DATA_FILE_ENV]: "/var/lib/koi/projection.json" },
      }),
    ).toBe("/var/lib/koi/projection.json");
  });
});
