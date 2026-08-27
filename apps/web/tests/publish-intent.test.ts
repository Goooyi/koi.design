import { describe, expect, it, vi } from "vite-plus/test";

import { createEmptyDocument, createInitialProjection, type ElementInput } from "@koi/core";
import { EditorStore } from "@koi/editor";

import { HostedKoiError, HostedPublishOutcomeUnknownError } from "../src/hosting/client.js";
import {
  attemptHostedPublish,
  HostedPublishIntentConflictError,
  HostedPublishIntentCoordinator,
} from "../src/hosting/publish-intent.js";

function createTarget(revision = 0) {
  const document = createEmptyDocument({
    id: "hosted-document",
    workspaceId: "hosted-workspace",
    name: "Hosted canvas",
    pageId: "hosted-page",
    historyId: "hosted-history",
    designProfileVersion: "0.5.0",
  });
  return createInitialProjection({ ...document, revision });
}

const frame: ElementInput = {
  schemaVersion: 1,
  id: "frame-locked-source",
  kind: "frame",
  parentId: null,
  geometry: { x: 0, y: 0, width: 320, height: 240, rotation: 0 },
  properties: { clipContent: false },
};

describe("HostedPublishIntentCoordinator", () => {
  it("reuses the exact unresolved request after the target revision changes", () => {
    const intents = new HostedPublishIntentCoordinator(() => "publish_stable");
    const first = intents.prepare("https://koi.example", createTarget(0), '{"name":"Local"}');
    const retry = intents.prepare("https://koi.example", createTarget(1), '{"name":"Local"}');

    expect(retry).toBe(first);
    expect(retry).toEqual({
      commandId: "publish_stable",
      expectedDocumentId: "hosted-document",
      expectedRevision: 0,
      documentJson: '{"name":"Local"}',
    });
    expect(Object.isFrozen(retry)).toBe(true);
  });

  it("blocks a different publish while an outcome remains unresolved", async () => {
    const intents = new HostedPublishIntentCoordinator(() => "publish_unknown");
    const publish = vi.fn(async (request) => {
      throw new HostedPublishOutcomeUnknownError(request, new TypeError("connection reset"));
    });

    await expect(
      attemptHostedPublish(
        intents,
        "https://koi.example",
        createTarget(),
        '{"name":"First"}',
        publish,
      ),
    ).rejects.toBeInstanceOf(HostedPublishOutcomeUnknownError);
    expect(() =>
      intents.prepare("https://koi.example", createTarget(), '{"name":"Different"}'),
    ).toThrow(HostedPublishIntentConflictError);

    const retry = intents.prepare("https://koi.example", createTarget(1), '{"name":"First"}');
    expect(retry.commandId).toBe("publish_unknown");
    expect(retry.expectedRevision).toBe(0);
  });

  it.each([
    [409, "CONFLICT"],
    [503, "SERVER_BUSY"],
    [507, "CAPACITY_EXCEEDED"],
  ])(
    "abandons a definitely rejected %s %s intent so a corrected publish can start",
    async (status, code) => {
      const commandIds = ["publish_rejected", "publish_corrected"];
      const intents = new HostedPublishIntentCoordinator(() => commandIds.shift()!);

      await expect(
        attemptHostedPublish(
          intents,
          "https://koi.example",
          createTarget(),
          '{"name":"Rejected"}',
          async () => {
            throw new HostedKoiError(status, code, "Definite rejection");
          },
        ),
      ).rejects.toMatchObject({ code });

      expect(
        intents.prepare("https://koi.example", createTarget(1), '{"name":"Corrected"}').commandId,
      ).toBe("publish_corrected");
    },
  );

  it("clears an unresolved intent only after opening its authoritative target", () => {
    const commandIds = ["publish_unknown", "publish_after_open"];
    const intents = new HostedPublishIntentCoordinator(() => commandIds.shift()!);
    intents.prepare("https://koi.example", createTarget(), '{"name":"First"}');

    intents.clearAfterAuthoritativeOpen("https://other.example", "hosted-document");
    expect(() =>
      intents.prepare("https://koi.example", createTarget(), '{"name":"Different"}'),
    ).toThrow(HostedPublishIntentConflictError);

    intents.clearAfterAuthoritativeOpen("https://koi.example", "hosted-document");
    expect(
      intents.prepare("https://koi.example", createTarget(1), '{"name":"Different"}').commandId,
    ).toBe("publish_after_open");
  });

  it("blocks an unrelated target while a publish outcome remains unresolved", () => {
    const intents = new HostedPublishIntentCoordinator(() => "publish_unknown");
    intents.prepare("https://koi.example", createTarget(), '{"name":"First"}');

    expect(() =>
      intents.requireUnresolvedTarget("https://other.example", "hosted-document"),
    ).toThrow(HostedPublishIntentConflictError);
    expect(() => intents.requireUnresolvedTarget("https://koi.example", "other-document")).toThrow(
      HostedPublishIntentConflictError,
    );
    expect(() =>
      intents.requireUnresolvedTarget("https://koi.example", "hosted-document"),
    ).not.toThrow();
  });

  it("blocks an unrelated host before its workspace can be opened or created", () => {
    const intents = new HostedPublishIntentCoordinator(() => "publish_unknown");
    intents.prepare("https://koi.example", createTarget(), '{"name":"First"}');

    expect(() => intents.requireUnresolvedBaseUrl("https://other.example")).toThrow(
      HostedPublishIntentConflictError,
    );
    expect(() => intents.requireUnresolvedBaseUrl("https://koi.example")).not.toThrow();
  });

  it("blocks non-host transitions until an unresolved publish is reconciled", () => {
    const intents = new HostedPublishIntentCoordinator(() => "publish_unknown");
    const request = intents.prepare("https://koi.example", createTarget(), '{"name":"First"}');

    expect(() => intents.requireNoUnresolved()).toThrow(HostedPublishIntentConflictError);

    intents.complete(request);
    expect(() => intents.requireNoUnresolved()).not.toThrow();
  });

  it("keeps the source interaction-locked until durable publish resolution", () => {
    const store = new EditorStore({ projection: createTarget() });
    const intents = new HostedPublishIntentCoordinator(() => "publish_unknown");
    const request = intents.prepare(
      "https://koi.example",
      store.getProjection(),
      '{"name":"First"}',
    );

    intents.retainInteractionLock(store);
    intents.retainInteractionLock(store);

    expect(store.getInteractionLocked()).toBe(true);
    expect(store.createElement(store.getPageId(), frame)).toMatchObject({
      ok: false,
      error: { code: "INTERACTION_LOCKED" },
    });

    intents.complete(request);
    expect(store.getInteractionLocked()).toBe(false);
  });

  it("keeps an earlier ambiguous intent when its later exact retry is definitely rejected", async () => {
    const intents = new HostedPublishIntentCoordinator(() => "publish_unknown");
    const target = createTarget();
    const unknown = vi.fn(async (request) => {
      throw new HostedPublishOutcomeUnknownError(request, new TypeError("connection reset"));
    });

    await expect(
      attemptHostedPublish(intents, "https://koi.example", target, '{"name":"First"}', unknown),
    ).rejects.toBeInstanceOf(HostedPublishOutcomeUnknownError);
    await expect(
      attemptHostedPublish(
        intents,
        "https://koi.example",
        createTarget(1),
        '{"name":"First"}',
        async () => {
          throw new HostedKoiError(503, "SERVER_BUSY", "Definite rejection of this retry");
        },
      ),
    ).rejects.toMatchObject({ code: "SERVER_BUSY" });

    expect(() => intents.requireNoUnresolved()).toThrow(HostedPublishIntentConflictError);
  });
});
