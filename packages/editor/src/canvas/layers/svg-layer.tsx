import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import type { KoiElement, Page, Point } from "@koi/core";

import { useEditorRuntime } from "../../runtime/editor-context.js";
import { useIsSelected, usePreviewRevision } from "../../store/hooks.js";
import { connectorAnchor, worldGeometry } from "../geometry.js";
import { useElementDrag } from "../interaction/use-element-drag.js";
import { canvasStyles } from "../styles.js";
import { sx } from "../sx.js";

function pointsToPath(points: readonly Point[], offsetX = 0, offsetY = 0): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x + offsetX} ${point.y + offsetY}`)
    .join(" ");
}

function ShapeNode({
  element,
  page,
  elementsById,
}: {
  element: Extract<KoiElement, { kind: "shape" }>;
  page: Page;
  elementsById: ReadonlyMap<string, KoiElement>;
}) {
  const { store } = useEditorRuntime();
  const { handlers, preview } = useElementDrag(element, page.id);
  const selected = useIsSelected(store, element.id);
  const geometry = worldGeometry(element, elementsById, (elementId) =>
    elementId === element.id ? { x: 0, y: 0 } : store.getPreviewOffset(elementId),
  );
  const x = geometry.x + preview.x;
  const y = geometry.y + preview.y;
  const common = {
    ...handlers,
    ...stylex.props(selected && canvasStyles.svgSelected),
    fill: element.properties.fill ?? "transparent",
    stroke: element.properties.stroke ?? "#33405d",
    strokeWidth: element.properties.strokeWidth,
    vectorEffect: "non-scaling-stroke" as const,
    pointerEvents: "all" as const,
  };
  if (element.properties.shape === "ellipse") {
    return (
      <ellipse
        {...common}
        cx={x + geometry.width / 2}
        cy={y + geometry.height / 2}
        rx={geometry.width / 2}
        ry={geometry.height / 2}
      />
    );
  }
  if (element.properties.shape === "line" || element.properties.shape === "arrow") {
    return (
      <line
        {...common}
        x1={x}
        y1={y}
        x2={x + geometry.width}
        y2={y + geometry.height}
        markerEnd={element.properties.shape === "arrow" ? "url(#koi-arrow)" : undefined}
      />
    );
  }
  return <rect {...common} x={x} y={y} width={geometry.width} height={geometry.height} />;
}

function ConnectorNode({
  element,
  elementsById,
}: {
  element: Extract<KoiElement, { kind: "connector" }>;
  elementsById: ReadonlyMap<string, KoiElement>;
}) {
  const { store } = useEditorRuntime();
  const selected = useIsSelected(store, element.id);
  const fromElement = elementsById.get(element.properties.from.elementId);
  const toElement = elementsById.get(element.properties.to.elementId);
  if (!fromElement || !toElement) return null;
  const from = connectorAnchor(
    worldGeometry(fromElement, elementsById, store.getPreviewOffset),
    element.properties.from.anchor,
  );
  const to = connectorAnchor(
    worldGeometry(toElement, elementsById, store.getPreviewOffset),
    element.properties.to.anchor,
  );
  const path =
    element.properties.route === "bezier"
      ? `M${from.x} ${from.y} C${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`
      : element.properties.route === "orthogonal"
        ? `M${from.x} ${from.y} L${(from.x + to.x) / 2} ${from.y} L${(from.x + to.x) / 2} ${to.y} L${to.x} ${to.y}`
        : `M${from.x} ${from.y} L${to.x} ${to.y}`;
  return (
    <path
      d={path}
      fill="none"
      stroke={element.properties.stroke ?? "#66718c"}
      strokeWidth={element.properties.strokeWidth}
      vectorEffect="non-scaling-stroke"
      markerEnd="url(#koi-arrow)"
      pointerEvents="stroke"
      {...stylex.props(selected && canvasStyles.svgSelected)}
      onPointerDown={(event) => {
        event.stopPropagation();
        store.select([element.id]);
      }}
    />
  );
}

function InkNode({
  element,
  page,
  elementsById,
}: {
  element: Extract<KoiElement, { kind: "ink" }>;
  page: Page;
  elementsById: ReadonlyMap<string, KoiElement>;
}) {
  const { store } = useEditorRuntime();
  const { handlers, preview } = useElementDrag(element, page.id);
  const selected = useIsSelected(store, element.id);
  const geometry = worldGeometry(element, elementsById, (elementId) =>
    elementId === element.id ? { x: 0, y: 0 } : store.getPreviewOffset(elementId),
  );
  return (
    <path
      {...handlers}
      d={pointsToPath(element.properties.points, geometry.x + preview.x, geometry.y + preview.y)}
      fill="none"
      stroke={element.properties.color}
      strokeWidth={element.properties.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      pointerEvents="stroke"
      {...stylex.props(selected && canvasStyles.svgSelected)}
    />
  );
}

export function SvgLayer({
  page,
  elementsById,
  visibleElementIds,
  visibleConnectorIds,
}: {
  page: Page;
  elementsById: ReadonlyMap<string, KoiElement>;
  visibleElementIds: ReadonlySet<string>;
  visibleConnectorIds: ReadonlySet<string>;
}) {
  const { store } = useEditorRuntime();
  usePreviewRevision(store);
  const elements = page.elements.filter(
    (element) =>
      ((element.kind === "shape" || element.kind === "ink") && visibleElementIds.has(element.id)) ||
      (element.kind === "connector" && visibleConnectorIds.has(element.id)),
  );
  const clippedFrames = new Map<string, Extract<KoiElement, { kind: "frame" }>>();
  for (const element of elements) {
    let parentId = element.parentId;
    const visited = new Set([element.id]);
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = elementsById.get(parentId);
      if (!parent) break;
      if (parent.kind === "frame" && parent.properties.clipContent) {
        clippedFrames.set(parent.id, parent);
      }
      parentId = parent.parentId;
    }
  }
  const clipPathIds = new Map<string, string>();
  for (const frameId of clippedFrames.keys()) {
    clipPathIds.set(frameId, `koi-frame-clip-${clipPathIds.size}`);
  }

  const wrapWithAncestorClips = (element: KoiElement, node: ReactNode): ReactNode => {
    const ancestorClipIds: string[] = [];
    let parentId = element.parentId;
    const visited = new Set([element.id]);
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = elementsById.get(parentId);
      if (!parent) break;
      const clipPathId = clipPathIds.get(parent.id);
      if (clipPathId) ancestorClipIds.push(clipPathId);
      parentId = parent.parentId;
    }
    return ancestorClipIds.reduce<ReactNode>(
      (child, clipPathId) => <g clipPath={`url(#${clipPathId})`}>{child}</g>,
      node,
    );
  };

  return (
    <svg
      {...sx("koi-svg-layer", canvasStyles.layer, canvasStyles.svgLayer)}
      overflow="visible"
      aria-hidden="true"
    >
      <defs>
        <marker id="koi-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
        </marker>
        {[...clippedFrames.values()].map((frame) => {
          const geometry = worldGeometry(frame, elementsById, store.getPreviewOffset);
          return (
            <clipPath key={frame.id} id={clipPathIds.get(frame.id)}>
              <rect x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} />
            </clipPath>
          );
        })}
      </defs>
      {elements.map((element) => {
        let node: ReactNode;
        if (element.kind === "shape") {
          node = <ShapeNode element={element} page={page} elementsById={elementsById} />;
        } else if (element.kind === "connector") {
          node = <ConnectorNode element={element} elementsById={elementsById} />;
        } else if (element.kind === "ink") {
          node = <InkNode element={element} page={page} elementsById={elementsById} />;
        } else {
          return null;
        }
        return (
          <g key={element.id} data-element-id={element.id}>
            {wrapWithAncestorClips(element, node)}
          </g>
        );
      })}
    </svg>
  );
}
