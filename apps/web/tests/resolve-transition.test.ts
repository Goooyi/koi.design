import { describe, expect, it, vi } from "vite-plus/test";

import {
  acknowledgeAllOutboxEntries,
  applyCommand,
  createEmptyDocument,
  createInitialProjection,
  type Command,
  type Projection,
} from "@koi/core";

import { resolveHostedTransitionTarget } from "../src/hosting/resolve-transition.js";

const destinationAuthority = { kind: "hosted", baseUrl: "https://host-a.example" } as const;

function createProjection(id: string, name: string): Projection {
  return createInitialProjection(
    createEmptyDocument({
      id,
      workspaceId: "workspace-1",
      name,
      pageId: "page-1",
      historyId: "history-1",
      designProfileVersion: "0.5.0",
    }),
  );
}

function createPendingProjection(id: string): Projection {
  const initial = createProjection(id, "Hosted canvas");
  const command: Command = {
    documentId: id,
    commandId: "offline-create",
    clientId: "offline-client",
    clientSeq: 1,
    baseCursor: 0,
    origin: "human",
    operations: [
      {
        type: "create",
        pageId: "page-1",
        element: {
          schemaVersion: 1,
          id: "note-1",
          kind: "note",
          parentId: null,
          geometry: { x: 10, y: 20, width: 200, height: 120, rotation: 0 },
          properties: { content: "Offline", color: "#ffe694" },
        },
      },
    ],
  };
  const applied = applyCommand(initial, command);
  if (!applied.ok) throw new Error(applied.error.message);
  return applied.projection;
}

describe("hosted transition target resolution", () => {
  it("recovers a saved outbox belonging to the destination host before opening it", async () => {
    const pending = createPendingProjection("shared-document");
    const remote = acknowledgeAllOutboxEntries(pending);
    const checkpoints: Projection[] = [];
    const client = {
      sendCommand: vi.fn(async () => ({ cursor: 1 })),
      getProjection: vi.fn(async () => remote),
    };

    const resolved = await resolveHostedTransitionTarget({
      mode: "open",
      client,
      source: {
        projection: createProjection("active-document", "Active canvas"),
        authority: { kind: "local" },
      },
      hostedAuthority: destinationAuthority,
      remoteProjection: createProjection("shared-document", "Hosted canvas"),
      storedTarget: { projection: pending, authority: destinationAuthority },
      checkpoint: async (state) => {
        checkpoints.push(state.projection);
      },
    });

    expect(resolved).toEqual({ projection: remote, recovered: true });
    expect(client.sendCommand).toHaveBeenCalledOnce();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.outbox).toHaveLength(0);
  });

  it.each(["open", "publish"] as const)(
    "keeps an inactive local return target reachable when the next host uses its ID in %s mode",
    async (mode) => {
      const localReturn = createProjection("shared-document", "Local canvas");
      const publish = vi.fn();
      const client = {
        sendCommand: vi.fn(async () => ({ cursor: 1 })),
        getProjection: vi.fn(async () => localReturn),
      };

      await expect(
        resolveHostedTransitionTarget({
          mode,
          client,
          source: {
            projection: createProjection("hosted-b-document", "Hosted B canvas"),
            authority: { kind: "hosted", baseUrl: "https://host-b.example" },
          },
          hostedAuthority: destinationAuthority,
          remoteProjection: localReturn,
          storedTarget: { projection: localReturn, authority: { kind: "local" } },
          acceptActiveSourceAsAuthoritative: true,
          checkpoint: vi.fn(),
        }).then(({ projection }) => publish(projection)),
      ).rejects.toThrow("local return target");

      expect(publish).not.toHaveBeenCalled();
      expect(client.sendCommand).not.toHaveBeenCalled();
      expect(client.getProjection).not.toHaveBeenCalled();
    },
  );

  it("allows the active local canvas to publish to a hosted document with the same ID", async () => {
    const local = createProjection("shared-document", "Local canvas");
    const remote = createProjection("shared-document", "Remote canvas");
    const client = {
      sendCommand: vi.fn(async () => ({ cursor: 1 })),
      getProjection: vi.fn(async () => remote),
    };

    await expect(
      resolveHostedTransitionTarget({
        mode: "publish",
        client,
        source: { projection: local, authority: { kind: "local" } },
        hostedAuthority: destinationAuthority,
        remoteProjection: remote,
        storedTarget: { projection: local, authority: { kind: "local" } },
        checkpoint: vi.fn(),
      }),
    ).resolves.toEqual({ projection: remote, recovered: false });
  });

  it("allows an unchanged active local canvas to open a hosted document with the same ID", async () => {
    const local = createProjection("shared-document", "Shared canvas");
    const client = {
      sendCommand: vi.fn(async () => ({ cursor: 1 })),
      getProjection: vi.fn(async () => local),
    };

    await expect(
      resolveHostedTransitionTarget({
        mode: "open",
        client,
        source: { projection: local, authority: { kind: "local" } },
        hostedAuthority: destinationAuthority,
        remoteProjection: local,
        storedTarget: { projection: local, authority: { kind: "local" } },
        checkpoint: vi.fn(),
      }),
    ).resolves.toEqual({ projection: local, recovered: false });
  });

  it("allows Open to reconcile an unknown publish for the exact active same-ID source", async () => {
    const local = createProjection("shared-document", "Local canvas");
    const authoritative = createProjection("shared-document", "Published canvas");
    const client = {
      sendCommand: vi.fn(async () => ({ cursor: 1 })),
      getProjection: vi.fn(async () => authoritative),
    };

    await expect(
      resolveHostedTransitionTarget({
        mode: "open",
        client,
        source: { projection: local, authority: { kind: "local" } },
        hostedAuthority: destinationAuthority,
        remoteProjection: authoritative,
        storedTarget: { projection: local, authority: { kind: "local" } },
        acceptActiveSourceAsAuthoritative: true,
        checkpoint: vi.fn(),
      }),
    ).resolves.toEqual({ projection: authoritative, recovered: false });
  });

  it("refuses to publish over an inactive record owned by another host", async () => {
    const stored = createProjection("shared-document", "Shared canvas");
    const publish = vi.fn();
    const client = {
      sendCommand: vi.fn(async () => ({ cursor: 1 })),
      getProjection: vi.fn(async () => stored),
    };

    await expect(
      resolveHostedTransitionTarget({
        mode: "publish",
        client,
        source: {
          projection: createProjection("active-document", "Active canvas"),
          authority: { kind: "local" },
        },
        hostedAuthority: destinationAuthority,
        remoteProjection: stored,
        storedTarget: {
          projection: stored,
          authority: { kind: "hosted", baseUrl: "https://host-b.example" },
        },
        checkpoint: vi.fn(),
      }).then(({ projection }) => publish(projection)),
    ).rejects.toThrow("another host");

    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses to send another host's pending outbox to the destination host", async () => {
    const client = {
      sendCommand: vi.fn(),
      getProjection: vi.fn(),
    };

    await expect(
      resolveHostedTransitionTarget({
        mode: "open",
        client,
        source: {
          projection: createProjection("active-document", "Active canvas"),
          authority: { kind: "local" },
        },
        hostedAuthority: destinationAuthority,
        remoteProjection: createProjection("shared-document", "Hosted canvas"),
        storedTarget: {
          projection: createPendingProjection("shared-document"),
          authority: { kind: "hosted", baseUrl: "https://host-b.example" },
        },
        checkpoint: vi.fn(),
      }),
    ).rejects.toThrow("same document ID");

    expect(client.sendCommand).not.toHaveBeenCalled();
    expect(client.getProjection).not.toHaveBeenCalled();
  });
});
