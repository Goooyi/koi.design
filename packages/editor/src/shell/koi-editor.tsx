import { KoiThemeProvider } from "@koi/astryx";
import { useEffect, useMemo, useState } from "react";

import { Canvas } from "../canvas/canvas.js";
import { CameraController } from "../canvas/camera/camera.js";
import { HudController } from "../canvas/layers/hud-controller.js";
import { Inspector } from "../inspector/inspector.js";
import type { EditorStore } from "../store/editor-store.js";
import { useInteractionLocked } from "../store/hooks.js";
import { EditorContext, type EditorTool } from "./editor-context.js";
import { Toolbar } from "./toolbar.js";

export interface KoiEditorProps {
  store: EditorStore;
  camera?: CameraController;
  title?: string;
  status?: string;
  onExport?: () => void;
  onImport?: () => void;
}

export function KoiEditor({
  store,
  camera: providedCamera,
  title = "Koi",
  status = "Local",
  onExport,
  onImport,
}: KoiEditorProps) {
  const ownCamera = useMemo(() => new CameraController(), []);
  const camera = providedCamera ?? ownCamera;
  const hud = useMemo(() => new HudController(), []);
  const [tool, setTool] = useState<EditorTool>("select");
  const [editingId, setEditingId] = useState<string | null>(null);
  const interactionLocked = useInteractionLocked(store);
  const runtime = useMemo(
    () => ({ store, camera, hud, tool, setTool, editingId, setEditingId }),
    [camera, editingId, hud, store, tool],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      const key = event.key.toLowerCase();
      if (key === "v") setTool("select");
      if (key === "h") setTool("hand");
      if (key === "p") setTool("pen");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <KoiThemeProvider>
      <EditorContext.Provider value={runtime}>
        <main
          className={`koi-editor-shell${interactionLocked ? " is-interaction-locked" : ""}`}
          aria-busy={interactionLocked}
        >
          <header className="koi-app-bar">
            <div className="koi-brand">
              <span className="koi-mark" aria-hidden="true">
                K
              </span>
              <div>
                <strong>{title}</strong>
                <small>{store.getDocument().name}</small>
              </div>
            </div>
            <div className="koi-app-actions">
              <span className="koi-status">
                <i />
                {status}
              </span>
              <button type="button" onClick={() => camera.reset()}>
                Reset view
              </button>
              <button type="button" onClick={() => store.undo()}>
                Undo
              </button>
            </div>
          </header>
          <div className="koi-editor-body">
            <Toolbar onExport={onExport} onImport={onImport} />
            <Canvas />
            <Inspector />
          </div>
        </main>
      </EditorContext.Provider>
    </KoiThemeProvider>
  );
}
