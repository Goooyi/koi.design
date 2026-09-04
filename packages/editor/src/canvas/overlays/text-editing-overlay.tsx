import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import type { JsonObject, KoiElement } from "@koi/core";

import { worldToScreen } from "../camera/camera.js";
import { elementMap, worldGeometry } from "../geometry.js";
import { useEditorRuntime } from "../../runtime/editor-context.js";
import { useElement } from "../../store/hooks.js";
import { canvasStyles } from "../styles.js";

type EditableElement = Extract<KoiElement, { kind: "text" | "note" }>;

function editingSurfaceStyle(element: EditableElement): CSSProperties {
  if (element.kind === "note") {
    return {
      background: element.properties.color ?? "#ffe694",
      color: "#3d351d",
      fontSize: 16,
      padding: 18,
    };
  }
  return {
    color: element.properties.style.color,
    fontFamily: element.properties.style.fontFamily,
    fontSize: element.properties.style.fontSize,
    fontWeight: element.properties.style.fontWeight,
    padding: 2,
    textAlign: element.properties.style.align,
  };
}

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
      {...stylex.props(canvasStyles.textEditor)}
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
      style={editingSurfaceStyle(element)}
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
