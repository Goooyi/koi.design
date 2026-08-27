import { describe, expect, it } from "vite-plus/test";

import type { KoiElement } from "@koi/core";

import { screenToWorld, worldToScreen, zoomAround } from "../src/canvas/camera/camera.js";
import { connectorBounds } from "../src/canvas/geometry.js";
import { SpatialIndex } from "../src/canvas/visibility/spatial-index.js";

describe("camera math", () => {
  it("keeps the world point under the pointer fixed while zooming", () => {
    const camera = { x: 120, y: 80, zoom: 0.8 };
    const pointer = { x: 640, y: 360 };
    const before = screenToWorld(pointer, camera);
    const next = zoomAround(camera, pointer, 1.6);

    expect(screenToWorld(pointer, next)).toEqual(before);
    expect(worldToScreen(before, next)).toEqual(pointer);
  });
});

describe("SpatialIndex", () => {
  it("indexes a long connector crossing the viewport even when both endpoints are offscreen", () => {
    const left: KoiElement = {
      schemaVersion: 1,
      id: "left",
      kind: "shape",
      version: 1,
      parentId: null,
      geometry: { x: -1_200, y: 0, width: 100, height: 100, rotation: 0 },
      properties: { shape: "rectangle", strokeWidth: 1 },
    };
    const right: KoiElement = {
      ...left,
      id: "right",
      geometry: { ...left.geometry, x: 1_100 },
    };
    const connector: Extract<KoiElement, { kind: "connector" }> = {
      schemaVersion: 1,
      id: "connector",
      kind: "connector",
      version: 1,
      parentId: null,
      geometry: { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
      properties: {
        from: { elementId: left.id, anchor: "right" },
        to: { elementId: right.id, anchor: "left" },
        route: "straight",
        points: [],
        strokeWidth: 2,
      },
    };
    const bounds = connectorBounds(
      connector,
      new Map([
        [left.id, left],
        [right.id, right],
      ]),
    );
    expect(bounds).toBeDefined();
    if (!bounds) return;
    const index = new SpatialIndex(100);
    index.set(connector.id, bounds);

    expect(index.query({ x: -50, y: 0, width: 100, height: 100, rotation: 0 })).toEqual([
      connector.id,
    ]);
  });

  it("queries only intersecting records across positive and negative grid cells", () => {
    const index = new SpatialIndex(100);
    index.set("negative", { x: -150, y: -50, width: 60, height: 60, rotation: 0 });
    index.set("visible", { x: 40, y: 40, width: 80, height: 80, rotation: 0 });
    index.set("far", { x: 900, y: 900, width: 40, height: 40, rotation: 0 });

    expect(index.query({ x: -100, y: -100, width: 250, height: 250, rotation: 0 }).sort()).toEqual([
      "negative",
      "visible",
    ]);
  });

  it("handles maximum-size records and queries without enumerating billions of cells", () => {
    const index = new SpatialIndex();
    index.set("giant", {
      x: -1_000_000_000,
      y: -1_000_000_000,
      width: 100_000_000,
      height: 100_000_000,
      rotation: 0,
    });
    index.set("small", { x: 10, y: 20, width: 40, height: 40, rotation: 0 });

    expect(
      index.query({
        x: -950_000_000,
        y: -950_000_000,
        width: 100,
        height: 100,
        rotation: 0,
      }),
    ).toEqual(["giant"]);
    expect(
      index
        .query({
          x: -1_000_000_000,
          y: -1_000_000_000,
          width: 1_000_000_100,
          height: 1_000_000_100,
          rotation: 0,
        })
        .sort(),
    ).toEqual(["giant", "small"]);
  });

  it("keeps aggregate grid membership bounded across many medium-large records", () => {
    const index = new SpatialIndex(100);
    for (let record = 0; record < 500; record += 1) {
      index.set(`record-${record}`, {
        x: record * 2_000,
        y: 0,
        width: 1_400,
        height: 1_400,
        rotation: 0,
      });
    }

    expect(index.query({ x: 499 * 2_000, y: 0, width: 20, height: 20, rotation: 0 })).toEqual([
      "record-499",
    ]);
  });
});
