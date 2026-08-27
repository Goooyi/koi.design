import { useEffect, useRef } from "react";

import { elementMap, worldGeometry } from "../canvas/geometry.js";
import { worldToScreen } from "../canvas/camera/camera.js";
import { useEditorRuntime } from "../shell/editor-context.js";
import { usePreviewRevision, useProjection, useSelection } from "../store/hooks.js";

export function SelectionOverlay() {
  const { camera, store } = useEditorRuntime();
  const projection = useProjection(store);
  const selection = useSelection(store);
  const previewRevision = usePreviewRevision(store);
  const overlayRef = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{
    pointerX: number;
    pointerY: number;
    width: number;
    height: number;
  } | null>(null);
  const element = selection.length === 1 ? store.getElement(selection[0]!) : undefined;
  const page = store.getActivePage();

  useEffect(() => {
    const update = () => {
      const overlay = overlayRef.current;
      if (!overlay || !element || !page || element.kind === "connector") return;
      const geometry = worldGeometry(element, elementMap(page), store.getPreviewOffset);
      const topLeft = worldToScreen(geometry, camera.get());
      overlay.style.transform = `translate(${topLeft.x}px, ${topLeft.y}px)`;
      overlay.style.width = `${geometry.width * camera.get().zoom}px`;
      overlay.style.height = `${geometry.height * camera.get().zoom}px`;
    };
    update();
    return camera.subscribe(update);
  }, [camera, element, page, previewRevision, projection, store]);

  if (!element || !page || element.kind === "connector") return null;

  return (
    <div ref={overlayRef} className="koi-selection-overlay">
      <button
        type="button"
        className="koi-resize-handle"
        aria-label="Resize selected element"
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeStart.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            width: element.geometry.width,
            height: element.geometry.height,
          };
        }}
        onPointerMove={(event) => {
          const start = resizeStart.current;
          const overlay = overlayRef.current;
          if (!start || !overlay) return;
          const zoom = camera.get().zoom;
          overlay.style.width = `${Math.max(24, start.width + (event.clientX - start.pointerX) / zoom) * zoom}px`;
          overlay.style.height = `${Math.max(24, start.height + (event.clientY - start.pointerY) / zoom) * zoom}px`;
        }}
        onPointerUp={(event) => {
          const start = resizeStart.current;
          if (!start) return;
          resizeStart.current = null;
          const zoom = camera.get().zoom;
          store.patchElement(page.id, element.id, {
            geometry: {
              width: Math.max(24, start.width + (event.clientX - start.pointerX) / zoom),
              height: Math.max(24, start.height + (event.clientY - start.pointerY) / zoom),
            },
          });
        }}
        onPointerCancel={() => {
          resizeStart.current = null;
          const overlay = overlayRef.current;
          if (!overlay) return;
          overlay.style.width = `${element.geometry.width * camera.get().zoom}px`;
          overlay.style.height = `${element.geometry.height * camera.get().zoom}px`;
        }}
      />
    </div>
  );
}
