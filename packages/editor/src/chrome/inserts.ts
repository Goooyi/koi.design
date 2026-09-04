import { createComponentDefaults, type listComponents } from "@koi/astryx";

import type { ElementInput, KoiElement } from "@koi/core";

import { screenToWorld } from "../canvas/camera/camera.js";
import { useEditorRuntime } from "../runtime/editor-context.js";
import { useSelection } from "../store/hooks.js";

export type LibraryComponent = ReturnType<typeof listComponents>[number];

function placement(
  selected: KoiElement | undefined,
  camera: ReturnType<typeof useEditorRuntime>["camera"],
) {
  if (selected?.kind === "frame") {
    return { parentId: selected.id, x: 40, y: 56 };
  }
  const point = screenToWorld({ x: 440, y: 260 }, camera.get());
  return { parentId: null, x: point.x, y: point.y };
}

/**
 * Insert actions shared by the tool rail and the side panel. Every insert selects the new element
 * and returns to the Select tool, so the two surfaces behave identically.
 */
export function useInserts() {
  const { camera, setTool, store } = useEditorRuntime();
  const selection = useSelection(store);
  const page = store.getActivePage()!;
  const selected = selection.length === 1 ? store.getElement(selection[0]!) : undefined;

  const add = (element: ElementInput) => {
    const result = store.createElement(page.id, element);
    if (result.ok) {
      store.select([element.id]);
      setTool("select");
    }
  };

  const addFrame = () => {
    const point = screenToWorld({ x: 280, y: 180 }, camera.get());
    add({
      schemaVersion: 1,
      id: store.createId("frame"),
      kind: "frame",
      name: `Frame ${page.elements.filter((element) => element.kind === "frame").length + 1}`,
      parentId: null,
      geometry: { x: point.x, y: point.y, width: 520, height: 360, rotation: 0 },
      properties: { clipContent: false, background: "#ffffff" },
    });
  };

  const addText = () => {
    const target = placement(selected, camera);
    add({
      schemaVersion: 1,
      id: store.createId("text"),
      kind: "text",
      parentId: target.parentId,
      geometry: { x: target.x, y: target.y, width: 260, height: 64, rotation: 0 },
      properties: { content: "Write something", style: { fontSize: 24, fontWeight: 600 } },
    });
  };

  const addNote = () => {
    const target = placement(selected, camera);
    add({
      schemaVersion: 1,
      id: store.createId("note"),
      kind: "note",
      parentId: target.parentId,
      geometry: { x: target.x, y: target.y, width: 220, height: 160, rotation: 0 },
      properties: { content: "A thought worth keeping", color: "#ffe694" },
    });
  };

  const addShape = () => {
    const target = placement(selected, camera);
    add({
      schemaVersion: 1,
      id: store.createId("shape"),
      kind: "shape",
      parentId: target.parentId,
      geometry: { x: target.x, y: target.y, width: 180, height: 120, rotation: 0 },
      properties: { shape: "rectangle", fill: "#dfe7ff", stroke: "#3865e8", strokeWidth: 2 },
    });
  };

  const addConnector = () => {
    if (selection.length !== 2) return;
    const first = store.getElement(selection[0]!);
    const second = store.getElement(selection[1]!);
    if (!first || !second) return;
    add({
      schemaVersion: 1,
      id: store.createId("connector"),
      kind: "connector",
      parentId: null,
      geometry: { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
      properties: {
        from: { elementId: first.id, anchor: "auto" },
        to: { elementId: second.id, anchor: "auto" },
        route: "bezier",
        points: [],
        stroke: "#5d6780",
        strokeWidth: 2,
      },
    });
  };

  const addComponent = (component: LibraryComponent) => {
    const target = placement(selected, camera);
    add({
      schemaVersion: 1,
      id: store.createId("component"),
      kind: "component",
      name: component.label,
      parentId: target.parentId,
      geometry: {
        x: target.x,
        y: target.y,
        width: component.defaultWidth,
        height: component.defaultHeight,
        rotation: 0,
      },
      properties: {
        profile: "koi.astryx",
        profileVersion: "0.5.0",
        componentId: component.id,
        props: createComponentDefaults(component.id),
      },
    });
  };

  return {
    addFrame,
    addText,
    addNote,
    addShape,
    addConnector,
    addComponent,
    canConnect: selection.length === 2,
  };
}
