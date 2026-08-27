import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { JsonObject, KoiElement } from "@koi/core";

import { worldToScreen } from "../canvas/camera/camera.js";
import { elementMap, worldGeometry } from "../canvas/geometry.js";
import { useEditorRuntime } from "../shell/editor-context.js";
import { useElement } from "../store/hooks.js";

type EditableElement = Extract<KoiElement, { kind: "text" | "note" }>;

function ActiveTextEditor({
  initialElement,
  pageId,
}: {
  initialElement: EditableElement;
  pageId: string;
}) {
  const { camera, setEditingId, store } = useEditorRuntime();
  const element = useElement(store, initialElement.id);
  const overlayRef = useRef<HTMLTextAreaElement>(null);
  const baseVersion = useRef(initialElement.version);
  const canceling = useRef(false);
  const [value, setValue] = useState(initialElement.properties.content);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const update = () => {
      const overlay = overlayRef.current;
      const page = store.getActivePage();
      if (!overlay || !element || !page) return;
      const geometry = worldGeometry(element, elementMap(page));
      const point = worldToScreen(geometry, camera.get());
      overlay.style.transform = `translate(${point.x}px, ${point.y}px)`;
      overlay.style.width = `${Math.max(180, geometry.width * camera.get().zoom)}px`;
      overlay.style.height = `${Math.max(80, geometry.height * camera.get().zoom)}px`;
    };
    update();
    return camera.subscribe(update);
  }, [camera, element, store]);

  if (!element || (element.kind !== "text" && element.kind !== "note")) return null;

  const commit = () => {
    if (!dirty) {
      setEditingId(null);
      return;
    }
    const result = store.commit([
      {
        type: "patch",
        pageId,
        elementId: element.id,
        expectedVersion: baseVersion.current,
        changes: {
          properties: { ...element.properties, content: value } as JsonObject,
        },
      },
    ]);
    if (result.ok) {
      setEditingId(null);
    } else {
      requestAnimationFrame(() => overlayRef.current?.focus());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      canceling.current = true;
      setEditingId(null);
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      commit();
    }
  };

  return (
    <textarea
      ref={overlayRef}
      className="koi-text-editor-overlay"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        setDirty(true);
      }}
      onBlur={() => {
        if (!canceling.current) commit();
      }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={`Edit ${element.kind}`}
      autoFocus
    />
  );
}

export function TextEditingOverlay() {
  const { editingId, store } = useEditorRuntime();
  const element = useElement(store, editingId ?? "");
  const page = store.getActivePage();
  if (!element || !page || (element.kind !== "text" && element.kind !== "note")) return null;

  return <ActiveTextEditor key={element.id} initialElement={element} pageId={page.id} />;
}
