import { createContext, useContext, type Dispatch, type SetStateAction } from "react";

import type { CameraController } from "../canvas/camera/camera.js";
import type { HudController } from "../canvas/layers/hud-controller.js";
import type { EditorStore } from "../store/editor-store.js";

export type EditorTool = "select" | "hand" | "pen";

export interface EditorRuntime {
  store: EditorStore;
  camera: CameraController;
  hud: HudController;
  tool: EditorTool;
  setTool: Dispatch<SetStateAction<EditorTool>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
}

export const EditorContext = createContext<EditorRuntime | null>(null);

export function useEditorRuntime(): EditorRuntime {
  const runtime = useContext(EditorContext);
  if (!runtime) throw new Error("Editor components must be rendered inside KoiEditor");
  return runtime;
}
