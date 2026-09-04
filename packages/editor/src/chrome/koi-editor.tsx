import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { KoiThemeProvider } from "@koi/astryx";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
export type EditorPanel = "tools" | "inspector";

/**
 * Koi's width budget, after Astryx's layout guide: structural widths are the one place raw pixels
 * belong, everything inside them uses the spacing scale, and a region is dropped below its budget
 * rather than left to compete for space.
 *
 * ```text
 * > 1024px   tools 256 | canvas | inspector 380   both resizable, both collapsible
 * <= 1024px  the inspector is dropped; the app bar toggle brings it back
 * <= 768px   the tools panel is dropped too; the canvas takes the width
 * ```
 *
 * The inspector minimum keeps two number inputs per row; the maximum stops it eating the canvas.
 */
export const editorWidthBudget = {
  tools: { defaultSize: 256, minSizePx: 208, maxSizePx: 320 },
  inspector: { defaultSize: 380, minSizePx: 372, maxSizePx: 480 },
  dropInspectorAt: 1024,
  dropToolsAt: 768,
} as const;

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

  const tools = useResizable({ ...editorWidthBudget.tools, collapsible: true, collapsedSize: 0 });
  const inspector = useResizable({
    ...editorWidthBudget.inspector,
    collapsible: true,
    collapsedSize: 0,
  });
  const regions = useRef({ tools, inspector });
  regions.current = { tools, inspector };
  const isInspectorDropped = useMediaQuery(
    `(max-width: ${editorWidthBudget.dropInspectorAt}px)`,
    false,
  );
  const isToolsDropped = useMediaQuery(`(max-width: ${editorWidthBudget.dropToolsAt}px)`, false);
  useEffect(() => {
    const region = regions.current.inspector;
    if (isInspectorDropped) region.collapse();
    else region.expand();
  }, [isInspectorDropped]);
  useEffect(() => {
    const region = regions.current.tools;
    if (isToolsDropped) region.collapse();
    else region.expand();
  }, [isToolsDropped]);

  const openPanels: EditorPanel[] = [];
  if (!tools.isCollapsed) openPanels.push("tools");
  if (!inspector.isCollapsed) openPanels.push("inspector");
  const setOpenPanels = (next: readonly EditorPanel[]) => {
    if (next.includes("tools")) tools.expand();
    else tools.collapse();
    if (next.includes("inspector")) inspector.expand();
    else inspector.collapse();
  };

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
                  openPanels={openPanels}
                  onOpenPanelsChange={setOpenPanels}
                  onResetView={() => camera.reset()}
                  onUndo={() => store.undo()}
                />
              </LayoutHeader>
            }
            start={
              <>
                {!tools.isCollapsed && (
                  <LayoutPanel
                    role="complementary"
                    label="Editor tools"
                    resizable={tools.props}
                    hasDivider={false}
                    padding={3}
                    isScrollable
                  >
                    <ToolPanel onExport={onExport} onImport={onImport} />
                  </LayoutPanel>
                )}
                <ResizeHandle hasDivider resizable={tools.props} label="Resize tools" />
              </>
            }
            content={
              <LayoutContent padding={0} isScrollable={false}>
                <Canvas />
              </LayoutContent>
            }
            end={
              <>
                <ResizeHandle
                  isReversed
                  hasDivider
                  resizable={inspector.props}
                  label="Resize inspector"
                />
                {!inspector.isCollapsed && (
                  <LayoutPanel
                    role="complementary"
                    label="Element inspector"
                    resizable={inspector.props}
                    hasDivider={false}
                    padding={3}
                    isScrollable
                  >
                    <Inspector />
                  </LayoutPanel>
                )}
              </>
            }
          />
        </div>
        {children}
      </EditorContext.Provider>
    </KoiThemeProvider>
  );
}
