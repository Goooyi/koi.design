import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from "@astryxdesign/core/Layout";
import { KoiThemeProvider } from "@koi/astryx";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Canvas } from "../canvas/canvas.js";
import { CameraController } from "../canvas/camera/camera.js";
import { HudController } from "../canvas/layers/hud-controller.js";
import { sx } from "../canvas/sx.js";
import { EditorContext, type EditorTool } from "../runtime/editor-context.js";
import type { EditorStore } from "../store/editor-store.js";
import { useInteractionLocked } from "../store/hooks.js";
import { AppBar } from "./app-bar.js";
import { Inspector } from "./inspector.js";
import { chromeStyles } from "./styles.js";
import { ToolPanel } from "./tool-panel.js";

export type EditorStatusTone = "ok" | "busy" | "error";

export interface KoiEditorProps {
  store: EditorStore;
  camera?: CameraController;
  title?: string;
  status?: string;
  statusTone?: EditorStatusTone;
  /** Host-provided controls rendered in the app bar next to the status. */
  actions?: ReactNode;
  /** Host overlays such as dialogs and toasts, rendered inside the theme and layer providers. */
  children?: ReactNode;
  onExport?: () => void;
  onImport?: () => void;
}

export function KoiEditor({
  store,
  camera: providedCamera,
  title = "Koi",
  status = "Local",
  statusTone = "ok",
  actions,
  children,
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
        <div
          {...sx("koi-editor-shell", chromeStyles.shell, interactionLocked && chromeStyles.locked)}
          aria-busy={interactionLocked}
        >
          <Layout
            height="fill"
            padding={0}
            header={
              <LayoutHeader hasDivider padding={0} height={48}>
                <AppBar
                  title={title}
                  documentName={store.getDocument().name}
                  status={status}
                  statusTone={statusTone}
                  actions={actions}
                  onResetView={() => camera.reset()}
                  onUndo={() => store.undo()}
                />
              </LayoutHeader>
            }
            start={
              <LayoutPanel
                role="complementary"
                label="Editor tools"
                width={256}
                hasDivider
                padding={3}
              >
                <ToolPanel onExport={onExport} onImport={onImport} />
              </LayoutPanel>
            }
            content={
              <LayoutContent padding={0} isScrollable={false}>
                <Canvas />
              </LayoutContent>
            }
            end={
              <LayoutPanel
                role="complementary"
                label="Element inspector"
                width={288}
                hasDivider
                padding={3}
              >
                <Inspector />
              </LayoutPanel>
            }
          />
        </div>
        {children}
      </EditorContext.Provider>
    </KoiThemeProvider>
  );
}
