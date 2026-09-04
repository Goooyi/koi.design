import { renderComponent } from "@koi/astryx";
import * as stylex from "@stylexjs/stylex";
import type { CSSProperties } from "react";

import type { KoiElement, Page } from "@koi/core";

import { useElementDrag } from "../interaction/use-element-drag.js";
import { useEditorRuntime } from "../../runtime/editor-context.js";
import { useElement, useIsSelected } from "../../store/hooks.js";
import { canvasStyles } from "../styles.js";
import { sx } from "../sx.js";

const domKinds = new Set<KoiElement["kind"]>([
  "frame",
  "component",
  "text",
  "note",
  "image",
  "shader",
]);

function elementStyle(element: KoiElement, dx: number, dy: number): CSSProperties {
  return {
    left: element.geometry.x + dx,
    top: element.geometry.y + dy,
    width: element.geometry.width,
    height: element.geometry.height,
    transform: `rotate(${element.geometry.rotation}deg)`,
  };
}

function ElementContent({ element }: { element: KoiElement }) {
  const { store } = useEditorRuntime();
  switch (element.kind) {
    case "frame":
      return (
        <div
          {...stylex.props(canvasStyles.fill, canvasStyles.frameSurface)}
          style={{ background: element.properties.background ?? "#ffffff" }}
        />
      );
    case "component":
      return (
        <div {...stylex.props(canvasStyles.fill, canvasStyles.componentSurface)}>
          {renderComponent(element.properties.componentId, element.properties.props)}
        </div>
      );
    case "text":
      return (
        <div
          {...stylex.props(canvasStyles.fill, canvasStyles.textSurface)}
          style={{
            color: element.properties.style.color,
            fontFamily: element.properties.style.fontFamily,
            fontSize: element.properties.style.fontSize,
            fontWeight: element.properties.style.fontWeight,
            textAlign: element.properties.style.align,
          }}
        >
          {element.properties.content}
        </div>
      );
    case "note":
      return (
        <div
          {...sx("koi-note-surface", canvasStyles.fill, canvasStyles.noteSurface)}
          style={{ background: element.properties.color ?? "#ffe694" }}
        >
          {element.properties.content}
        </div>
      );
    case "image": {
      const asset = store.getAsset(element.properties.assetId);
      return asset ? (
        <img
          {...stylex.props(canvasStyles.fill, canvasStyles.imageSurface)}
          src={asset.uri}
          alt={element.properties.alt}
          draggable={false}
          style={{ objectFit: element.properties.fit }}
        />
      ) : (
        <div {...stylex.props(canvasStyles.fill, canvasStyles.missingSurface)}>Missing image</div>
      );
    }
    case "shader":
      return (
        <div {...stylex.props(canvasStyles.fill, canvasStyles.shaderSurface)}>
          <span {...stylex.props(canvasStyles.shaderMeta)}>WebGPU leaf</span>
          <strong>{element.properties.shaderId}</strong>
          <small {...stylex.props(canvasStyles.shaderMeta)}>Capability-gated preview</small>
        </div>
      );
    default:
      return null;
  }
}

function DomElementNode({
  elementId,
  page,
  childrenByParent,
}: {
  elementId: string;
  page: Page;
  childrenByParent: ReadonlyMap<string, readonly KoiElement[]>;
}) {
  const { setEditingId, store, tool } = useEditorRuntime();
  const element = useElement(store, elementId);
  const selected = useIsSelected(store, elementId);
  const { handlers, preview } = useElementDrag(element, page.id);
  if (!element || !domKinds.has(element.kind)) return null;
  const children = childrenByParent.get(element.id) ?? [];
  const isFrame = element.kind === "frame";

  return (
    <div
      {...handlers}
      {...sx(
        selected ? "koi-dom-element is-selected" : "koi-dom-element",
        canvasStyles.element,
        isFrame && canvasStyles.frame,
        tool === "select" && !isFrame && canvasStyles.hoverable,
        selected && canvasStyles.selected,
      )}
      data-element-id={element.id}
      data-element-kind={element.kind}
      onDoubleClick={
        element.kind === "text" || element.kind === "note"
          ? (event) => {
              event.stopPropagation();
              setEditingId(element.id);
            }
          : undefined
      }
      style={elementStyle(element, preview.x, preview.y)}
      role="group"
      aria-label={element.name ?? `${element.kind} ${element.id}`}
    >
      {isFrame && (
        <span
          {...sx(
            "koi-frame-label",
            canvasStyles.frameLabel,
            selected && canvasStyles.frameLabelSelected,
          )}
        >
          {element.name ?? "Frame"}
        </span>
      )}
      <ElementContent element={element} />
      {element.kind === "frame" && (
        <div
          {...stylex.props(canvasStyles.frameChildren)}
          style={{ overflow: element.properties.clipContent ? "hidden" : "visible" }}
        >
          {children
            .filter((child) => domKinds.has(child.kind))
            .map((child) => (
              <DomElementNode
                key={child.id}
                elementId={child.id}
                page={page}
                childrenByParent={childrenByParent}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export function DomLayer({
  page,
  visibleRootIds,
  childrenByParent,
}: {
  page: Page;
  visibleRootIds: ReadonlySet<string>;
  childrenByParent: ReadonlyMap<string, readonly KoiElement[]>;
}) {
  const roots = page.elements.filter(
    (element) =>
      element.parentId === null && domKinds.has(element.kind) && visibleRootIds.has(element.id),
  );
  return (
    <div {...stylex.props(canvasStyles.layer, canvasStyles.domLayer)}>
      {roots.map((element) => (
        <DomElementNode
          key={element.id}
          elementId={element.id}
          page={page}
          childrenByParent={childrenByParent}
        />
      ))}
    </div>
  );
}
