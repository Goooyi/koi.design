import { describe, expect, it } from "vite-plus/test";

import { documentSchema, type KoiElement } from "../src/index.js";
import { documentWith, frame, text } from "./fixtures.js";

describe("a mixed spatial Page", () => {
  it("validates portable UI, whiteboard, media, and GPU Elements together", () => {
    const elements: KoiElement[] = [
      frame("frame-1"),
      {
        schemaVersion: 1,
        id: "component-1",
        kind: "component",
        version: 1,
        parentId: "frame-1",
        geometry: { x: 40, y: 40, width: 120, height: 40, rotation: 0 },
        properties: {
          profile: "koi.astryx",
          profileVersion: "0.5.0",
          componentId: "button",
          props: { label: "Continue", intent: "primary" },
        },
      },
      text("text-1", "frame-1"),
      {
        schemaVersion: 1,
        id: "note-1",
        kind: "note",
        version: 1,
        parentId: null,
        geometry: { x: 900, y: 40, width: 240, height: 180, rotation: 0 },
        properties: { content: "Review the primary action", color: "#fff2a8" },
      },
      {
        schemaVersion: 1,
        id: "shape-1",
        kind: "shape",
        version: 1,
        parentId: null,
        geometry: { x: 850, y: 300, width: 160, height: 100, rotation: 0 },
        properties: { shape: "ellipse", fill: "#badaff", strokeWidth: 1 },
      },
      {
        schemaVersion: 1,
        id: "ink-1",
        kind: "ink",
        version: 1,
        parentId: null,
        geometry: { x: 0, y: 0, width: 80, height: 30, rotation: 0 },
        properties: {
          points: [
            { x: 0, y: 0, pressure: 0.4 },
            { x: 80, y: 30, pressure: 0.8 },
          ],
          color: "#222",
          width: 3,
        },
      },
      {
        schemaVersion: 1,
        id: "image-1",
        kind: "image",
        version: 1,
        parentId: "frame-1",
        geometry: { x: 40, y: 120, width: 320, height: 180, rotation: 0 },
        properties: { assetId: "asset-preview", alt: "Product preview", fit: "cover" },
      },
      {
        schemaVersion: 1,
        id: "shader-1",
        kind: "shader",
        version: 1,
        parentId: "frame-1",
        geometry: { x: 400, y: 120, width: 320, height: 180, rotation: 0 },
        properties: {
          shaderId: "gradient-mesh",
          parameters: { colors: ["#ff006e", "#3a86ff"] },
          playbackSpeed: 1,
          deterministicFrame: 0,
          quality: 1,
          fallbackAssetId: "asset-preview",
        },
      },
      {
        schemaVersion: 1,
        id: "connector-1",
        kind: "connector",
        version: 1,
        parentId: null,
        geometry: { x: 0, y: 0, width: 900, height: 200, rotation: 0 },
        properties: {
          from: { elementId: "component-1", anchor: "right" },
          to: { elementId: "note-1", anchor: "left" },
          route: "orthogonal",
          points: [],
          stroke: "#536471",
          strokeWidth: 2,
        },
      },
    ];
    const document = documentWith(elements);
    document.assets = [
      {
        schemaVersion: 1,
        id: "asset-preview",
        kind: "image",
        mediaType: "image/png",
        uri: "assets/product-preview.png",
        width: 1280,
        height: 720,
      },
    ];

    const parsed = documentSchema.safeParse(document);
    expect(parsed.success).toBe(true);
  });

  it("rejects cyclic nested Frames before they reach a renderer", () => {
    const root = frame("frame-root");
    const nested = frame("frame-nested", "frame-root");
    root.parentId = "frame-nested";

    const parsed = documentSchema.safeParse(documentWith([root, nested]));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.message.includes("cycle"))).toBe(true);
  });

  it("rejects rotation until every mixed renderer can share one affine transform model", () => {
    const rotated = frame("rotated-frame");
    Object.assign(rotated.geometry, { rotation: 2 });

    expect(documentSchema.safeParse(documentWith([rotated])).success).toBe(false);
  });

  it("rejects profile versions that the trusted renderer does not implement", () => {
    const base = documentWith();
    const futureDocument = {
      ...base,
      designProfile: { ...base.designProfile, version: "9.0.0" },
    };
    const mismatchedComponent = {
      ...base,
      pages: [
        {
          ...base.pages[0],
          elements: [
            {
              schemaVersion: 1,
              id: "component-1",
              kind: "component",
              version: 1,
              parentId: null,
              geometry: { x: 0, y: 0, width: 120, height: 40, rotation: 0 },
              properties: {
                profile: "koi.astryx",
                profileVersion: "9.0.0",
                componentId: "astryx.button",
                props: {},
              },
            },
          ],
        },
      ],
    };

    expect(documentSchema.safeParse(futureDocument).success).toBe(false);
    expect(documentSchema.safeParse(mismatchedComponent).success).toBe(false);
  });

  it("caps nesting depth so adversarial documents cannot create unbounded tree walks", () => {
    const elements = Array.from({ length: 66 }, (_, index) =>
      frame(`frame-${index}`, index === 0 ? null : `frame-${index - 1}`),
    );

    const parsed = documentSchema.safeParse(documentWith(elements));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.message.includes("maximum depth"))).toBe(true);
  });
});
