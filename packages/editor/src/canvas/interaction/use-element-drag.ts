import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { KoiElement } from "@koi/core";

import { useEditorRuntime } from "../../shell/editor-context.js";

export interface DragPreview {
  x: number;
  y: number;
}

export function useElementDrag(element: KoiElement | undefined, pageId: string) {
  const { camera, store, tool } = useEditorRuntime();
  const start = useRef<{ pointerX: number; pointerY: number; dragged: boolean } | null>(null);
  const [preview, setPreview] = useState<DragPreview>({ x: 0, y: 0 });

  useEffect(
    () => () => {
      if (element) store.clearPreviewOffset(element.id);
    },
    [element, store],
  );

  const onPointerDown = (event: ReactPointerEvent<SVGElement | HTMLElement>) => {
    if (!element || tool !== "select" || event.button !== 0) return;
    event.stopPropagation();
    store.select(event.shiftKey ? [...store.getSelection(), element.id] : [element.id]);
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { pointerX: event.clientX, pointerY: event.clientY, dragged: false };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGElement | HTMLElement>) => {
    const active = start.current;
    if (!active) return;
    if (
      !active.dragged &&
      Math.hypot(event.clientX - active.pointerX, event.clientY - active.pointerY) < 3
    )
      return;
    active.dragged = true;
    const zoom = camera.get().zoom;
    const next = {
      x: (event.clientX - active.pointerX) / zoom,
      y: (event.clientY - active.pointerY) / zoom,
    };
    setPreview(next);
    if (element) store.setPreviewOffset(element.id, next);
  };

  const finish = (event: ReactPointerEvent<SVGElement | HTMLElement>) => {
    const active = start.current;
    if (!active || !element) return;
    event.stopPropagation();
    const zoom = camera.get().zoom;
    const next = {
      x: (event.clientX - active.pointerX) / zoom,
      y: (event.clientY - active.pointerY) / zoom,
    };
    start.current = null;
    setPreview({ x: 0, y: 0 });
    store.clearPreviewOffset(element.id);
    if (!active.dragged) return;
    store.patchElement(pageId, element.id, {
      geometry: {
        x: element.geometry.x + next.x,
        y: element.geometry.y + next.y,
      },
    });
  };

  const cancel = (event: ReactPointerEvent<SVGElement | HTMLElement>) => {
    if (!start.current) return;
    event.stopPropagation();
    start.current = null;
    setPreview({ x: 0, y: 0 });
    if (element) store.clearPreviewOffset(element.id);
  };

  return {
    preview,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: cancel,
    },
  };
}
