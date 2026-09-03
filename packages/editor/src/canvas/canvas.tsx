import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { ElementInput, Geometry, KoiElement, Point } from "@koi/core";

import { useEditorRuntime } from "../shell/editor-context.js";
import { SelectionOverlay } from "../overlays/selection-overlay.js";
import { TextEditingOverlay } from "../overlays/text-editing-overlay.js";
import { useProjection, useSelection } from "../store/hooks.js";
import { screenToWorld, type Camera } from "./camera/camera.js";
import { connectorBounds, worldGeometry } from "./geometry.js";
import { DomLayer } from "./layers/dom-layer.js";
import { SvgLayer } from "./layers/svg-layer.js";
import { SpatialIndex } from "./visibility/spatial-index.js";

interface PointerSession {
  mode: "pan" | "pen";
  previous: Point;
  points: Point[];
}

const MAX_INK_POINTS = 4_096;
const VISIBILITY_REFRESH_INTERVAL_MS = 64;

function rootVisibilityGeometry(
  root: KoiElement,
  elementsById: ReadonlyMap<string, KoiElement>,
  childrenByParent: ReadonlyMap<string, readonly KoiElement[]>,
): Geometry {
  const initial = worldGeometry(root, elementsById);
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;
  const queue =
    root.kind === "frame" && !root.properties.clipContent
      ? [...(childrenByParent.get(root.id) ?? [])]
      : [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const child = queue[cursor]!;
    if (child.kind === "connector") continue;
    const geometry = worldGeometry(child, elementsById);
    left = Math.min(left, geometry.x);
    top = Math.min(top, geometry.y);
    right = Math.max(right, geometry.x + geometry.width);
    bottom = Math.max(bottom, geometry.y + geometry.height);
    if (child.kind === "frame" && !child.properties.clipContent) {
      queue.push(...(childrenByParent.get(child.id) ?? []));
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top, rotation: 0 };
}

function viewportWorldRect(width: number, height: number, camera: Camera): Geometry {
  const topLeft = screenToWorld({ x: -400, y: -400 }, camera);
  const bottomRight = screenToWorld({ x: width + 400, y: height + 400 }, camera);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
    rotation: 0,
  };
}

function makeInk(
  points: readonly Point[],
  createId: (prefix: string) => string,
): ElementInput | null {
  if (points.length < 2) return null;
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    schemaVersion: 1,
    id: createId("ink"),
    kind: "ink",
    parentId: null,
    geometry: {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      rotation: 0,
    },
    properties: {
      points: points.map((point) => ({ x: point.x - minX, y: point.y - minY })),
      color: "#2457ff",
      width: 3,
    },
  };
}

export function Canvas() {
  const runtime = useEditorRuntime();
  const { camera, hud, store, tool } = runtime;
  const projection = useProjection(store);
  const selection = useSelection(store);
  const page = store.getActivePage();
  const viewportRef = useRef<HTMLDivElement>(null);
  const session = useRef<PointerSession | null>(null);
  const visibilityTimer = useRef<number | null>(null);
  const lastVisibilityRefresh = useRef(0);
  const [viewport, setViewport] = useState({ width: 1, height: 1, revision: 0 });

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setViewport((current) => ({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
        revision: current.revision + 1,
      }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const refreshVisibility = () => {
      visibilityTimer.current = null;
      lastVisibilityRefresh.current = performance.now();
      setViewport((current) => ({ ...current, revision: current.revision + 1 }));
    };
    const unsubscribe = camera.subscribe(() => {
      const elapsed = performance.now() - lastVisibilityRefresh.current;
      if (elapsed >= VISIBILITY_REFRESH_INTERVAL_MS) {
        if (visibilityTimer.current !== null) window.clearTimeout(visibilityTimer.current);
        refreshVisibility();
      } else if (visibilityTimer.current === null) {
        visibilityTimer.current = window.setTimeout(
          refreshVisibility,
          VISIBILITY_REFRESH_INTERVAL_MS - elapsed,
        );
      }
    });
    return () => {
      unsubscribe();
      if (visibilityTimer.current !== null) window.clearTimeout(visibilityTimer.current);
    };
  }, [camera]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // React delegates wheel events passively, but the Canvas must suppress browser page zoom and
    // scrolling while it consumes the gesture for its own Camera.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        camera.zoomAt(
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          Math.exp(-event.deltaY * 0.006),
        );
      } else {
        camera.panBy(-event.deltaX, -event.deltaY);
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [camera, page?.id]);

  const pageIndex = useMemo(() => {
    const elementsById = new Map<string, KoiElement>();
    const childrenByParent = new Map<string, KoiElement[]>();
    for (const element of page?.elements ?? []) {
      elementsById.set(element.id, element);
      if (element.parentId) {
        const children = childrenByParent.get(element.parentId) ?? [];
        children.push(element);
        childrenByParent.set(element.parentId, children);
      }
    }
    return { elementsById, childrenByParent };
  }, [page]);

  const visibility = useMemo(() => {
    if (!page)
      return {
        rootIds: new Set<string>(),
        elementIds: new Set<string>(),
        connectorIds: new Set<string>(),
      };
    const roots = page.elements.filter(
      (element) => element.parentId === null && element.kind !== "connector",
    );
    const rootCandidates = new Set(roots.map((element) => element.id));
    const connectorCandidates = new Set<string>();
    const index = new SpatialIndex();
    for (const root of roots) {
      index.set(
        root.id,
        rootVisibilityGeometry(root, pageIndex.elementsById, pageIndex.childrenByParent),
      );
    }
    for (const element of page.elements) {
      if (element.kind !== "connector") continue;
      const bounds = connectorBounds(element, pageIndex.elementsById);
      if (!bounds) continue;
      connectorCandidates.add(element.id);
      index.set(element.id, bounds);
    }
    const visibleIds = index.query(
      viewportWorldRect(viewport.width, viewport.height, camera.get()),
    );
    const rootIds = new Set(visibleIds.filter((elementId) => rootCandidates.has(elementId)));
    const connectorIds = new Set(
      visibleIds.filter((elementId) => connectorCandidates.has(elementId)),
    );
    for (const selectedId of selection) {
      let selected = pageIndex.elementsById.get(selectedId);
      if (selected?.kind === "connector") {
        connectorIds.add(selected.id);
        continue;
      }
      while (selected?.parentId) selected = pageIndex.elementsById.get(selected.parentId);
      if (selected) rootIds.add(selected.id);
    }
    const elementIds = new Set(rootIds);
    const queue = [...rootIds];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const child of pageIndex.childrenByParent.get(queue[cursor]!) ?? []) {
        if (elementIds.has(child.id)) continue;
        elementIds.add(child.id);
        queue.push(child.id);
      }
    }
    return { rootIds, elementIds, connectorIds };
  }, [camera, page, pageIndex, projection.document.revision, selection, viewport]);

  if (!page) return <div className="koi-empty-canvas">No Page</div>;

  const localPoint = (event: ReactPointerEvent): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event);
    if (tool === "pen" && event.button === 0) {
      session.current = { mode: "pen", previous: point, points: [point] };
      store.select([]);
      return;
    }
    if (tool === "hand" || event.button === 1) {
      session.current = { mode: "pan", previous: point, points: [] };
      return;
    }
    store.select([]);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = session.current;
    if (!active) return;
    const point = localPoint(event);
    if (active.mode === "pan") {
      camera.panBy(point.x - active.previous.x, point.y - active.previous.y);
      active.previous = point;
      return;
    }
    const last = active.points.at(-1)!;
    if (
      active.points.length < MAX_INK_POINTS &&
      Math.hypot(point.x - last.x, point.y - last.y) >= 2
    ) {
      active.points.push(point);
      hud.drawStroke(active.points);
    }
  };

  const finishPointer = (commitInk: boolean) => {
    const active = session.current;
    session.current = null;
    if (!active) return;
    if (active.mode === "pan") {
      setViewport((current) => ({ ...current, revision: current.revision + 1 }));
      return;
    }
    hud.clear();
    if (!commitInk) return;
    const worldPoints = active.points.map((point) => screenToWorld(point, camera.get()));
    const ink = makeInk(worldPoints, store.createId);
    if (ink) {
      const result = store.createElement(page.id, ink);
      if (result.ok) store.select([ink.id]);
    }
  };

  return (
    <div
      ref={viewportRef}
      className={`koi-canvas koi-tool-${tool}`}
      role="region"
      aria-label={`${page.name} infinite canvas`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerDownCapture={(event) => {
        if (event.button === 0 || event.button === 1) {
          viewportRef.current?.focus({ preventScroll: true });
        }
      }}
      onPointerMove={onPointerMove}
      onPointerUp={() => finishPointer(true)}
      onPointerCancel={() => finishPointer(false)}
      onKeyDown={(event) => {
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          store.deleteSelection();
        } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          store.undo();
        }
      }}
    >
      <div className="koi-grid" />
      <div ref={camera.attachWorld} className="koi-world-root">
        <DomLayer
          page={page}
          visibleRootIds={visibility.rootIds}
          childrenByParent={pageIndex.childrenByParent}
        />
        <SvgLayer
          page={page}
          elementsById={pageIndex.elementsById}
          visibleElementIds={visibility.elementIds}
          visibleConnectorIds={visibility.connectorIds}
        />
      </div>
      <canvas ref={hud.attach} className="koi-hud" />
      <div className="koi-overlay-layer">
        <SelectionOverlay />
        <TextEditingOverlay />
      </div>
      <div className="koi-canvas-meta" aria-live="polite">
        <span>{Math.round(camera.get().zoom * 100)}%</span>
        <span>{page.elements.length} elements</span>
      </div>
    </div>
  );
}
