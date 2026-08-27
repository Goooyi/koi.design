import type { Document, KoiElement } from "../src/document/schema.js";

export function frame(id: string, parentId: string | null = null): KoiElement {
  return {
    schemaVersion: 1,
    id,
    kind: "frame",
    version: 1,
    parentId,
    geometry: { x: 0, y: 0, width: 800, height: 600, rotation: 0 },
    properties: { clipContent: false },
  };
}

export function text(id: string, parentId: string | null = null, content = "Hello"): KoiElement {
  return {
    schemaVersion: 1,
    id,
    kind: "text",
    version: 1,
    parentId,
    geometry: { x: 24, y: 24, width: 240, height: 48, rotation: 0 },
    properties: { content, style: {} },
  };
}

export function documentWith(elements: KoiElement[] = []): Document {
  return {
    schemaVersion: 1,
    id: "document-1",
    workspaceId: "workspace-1",
    name: "Component studies",
    revision: 0,
    historyId: "history-1",
    pages: [
      {
        schemaVersion: 1,
        id: "page-1",
        name: "Explorations",
        elements,
      },
    ],
    assets: [],
    designProfile: { id: "koi.astryx", version: "0.5.0", tokens: {} },
  };
}
