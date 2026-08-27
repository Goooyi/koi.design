import { documentSchema, type Document } from "@koi/core";

export function createDemoDocument(): Document {
  return documentSchema.parse({
    schemaVersion: 1,
    id: "document-demo",
    workspaceId: "workspace-local",
    name: "Koi component studies",
    revision: 0,
    historyId: "history-demo",
    pages: [
      {
        schemaVersion: 1,
        id: "page-explorations",
        name: "Explorations",
        elements: [
          {
            schemaVersion: 1,
            id: "frame-welcome",
            kind: "frame",
            version: 1,
            name: "Welcome",
            parentId: null,
            geometry: { x: 80, y: 100, width: 720, height: 520, rotation: 0 },
            properties: { clipContent: false, background: "#f8fafc" },
          },
          {
            schemaVersion: 1,
            id: "text-title",
            kind: "text",
            version: 1,
            parentId: "frame-welcome",
            geometry: { x: 128, y: 156, width: 440, height: 72, rotation: 0 },
            properties: {
              content: "Design with a human and an agent",
              style: { fontSize: 32, fontWeight: 700, color: "#172033" },
            },
          },
          {
            schemaVersion: 1,
            id: "component-primary-action",
            kind: "component",
            version: 1,
            parentId: "frame-welcome",
            geometry: { x: 128, y: 272, width: 220, height: 48, rotation: 0 },
            properties: {
              profile: "koi.astryx",
              profileVersion: "0.5.0",
              componentId: "astryx.button",
              props: { children: "Create an exploration", variant: "primary" },
            },
          },
          {
            schemaVersion: 1,
            id: "note-agent",
            kind: "note",
            version: 1,
            parentId: null,
            geometry: { x: 880, y: 140, width: 300, height: 220, rotation: 0 },
            properties: {
              content: "Move this note. The same semantic command is visible to the agent.",
              color: "#fef3c7",
            },
          },
          {
            schemaVersion: 1,
            id: "connector-intent",
            kind: "connector",
            version: 1,
            parentId: null,
            geometry: { x: 800, y: 220, width: 80, height: 40, rotation: 0 },
            properties: {
              from: { elementId: "frame-welcome", anchor: "right" },
              to: { elementId: "note-agent", anchor: "left" },
              route: "bezier",
              points: [],
              stroke: "#64748b",
              strokeWidth: 2,
            },
          },
        ],
      },
    ],
    assets: [],
    designProfile: { id: "koi.astryx", version: "0.5.0", tokens: {} },
  });
}
