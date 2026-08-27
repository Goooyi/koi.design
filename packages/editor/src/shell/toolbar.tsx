import { createComponentDefaults, listComponents } from "@koi/astryx";

import type { ElementInput, KoiElement } from "@koi/core";

import { screenToWorld } from "../canvas/camera/camera.js";
import { useEditorRuntime, type EditorTool } from "./editor-context.js";
import { useProjection, useSelection } from "../store/hooks.js";

interface ToolbarProps {
  onExport?: () => void;
  onImport?: () => void;
}

function ToolButton({
  label,
  shortcut,
  tool,
}: {
  label: string;
  shortcut: string;
  tool: EditorTool;
}) {
  const runtime = useEditorRuntime();
  return (
    <button
      type="button"
      className={runtime.tool === tool ? "is-active" : undefined}
      aria-pressed={runtime.tool === tool}
      onClick={() => runtime.setTool(tool)}
      title={`${label} (${shortcut})`}
    >
      <span>{label}</span>
      <kbd>{shortcut}</kbd>
    </button>
  );
}

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

export function Toolbar({ onExport, onImport }: ToolbarProps) {
  const { camera, setTool, store } = useEditorRuntime();
  const projection = useProjection(store);
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

  return (
    <aside className="koi-left-panel" aria-label="Editor tools">
      <section className="koi-tool-section">
        <h2>Tools</h2>
        <div className="koi-tool-grid">
          <ToolButton label="Select" shortcut="V" tool="select" />
          <ToolButton label="Hand" shortcut="H" tool="hand" />
          <ToolButton label="Pen" shortcut="P" tool="pen" />
          <button type="button" onClick={addFrame} title="Frame (F)">
            <span>Frame</span>
            <kbd>F</kbd>
          </button>
          <button type="button" onClick={addText} title="Text (T)">
            <span>Text</span>
            <kbd>T</kbd>
          </button>
          <button type="button" onClick={addNote} title="Note (N)">
            <span>Note</span>
            <kbd>N</kbd>
          </button>
          <button type="button" onClick={addShape} title="Shape (R)">
            <span>Shape</span>
            <kbd>R</kbd>
          </button>
          <button
            type="button"
            onClick={addConnector}
            disabled={selection.length !== 2}
            title="Connect selected elements (C)"
          >
            <span>Connect</span>
            <kbd>C</kbd>
          </button>
        </div>
      </section>

      <section className="koi-pages-section">
        <h2>Pages</h2>
        {projection.document.pages.map((candidate) => (
          <button
            type="button"
            className={candidate.id === page.id ? "is-current" : undefined}
            key={candidate.id}
            onClick={() => store.setPage(candidate.id)}
          >
            <span>{candidate.name}</span>
            <small>{candidate.elements.length}</small>
          </button>
        ))}
      </section>

      <section className="koi-library-section">
        <h2>Astryx library</h2>
        <p>Trusted HTML/CSS components</p>
        {listComponents().map((component) => (
          <button
            type="button"
            key={component.id}
            onClick={() => {
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
            }}
          >
            <span>{component.label}</span>
            <small>+</small>
          </button>
        ))}
      </section>

      {(onImport || onExport) && (
        <section className="koi-file-actions">
          {onImport && <button onClick={onImport}>Import .koi.json</button>}
          {onExport && <button onClick={onExport}>Export .koi.json</button>}
        </section>
      )}
    </aside>
  );
}
