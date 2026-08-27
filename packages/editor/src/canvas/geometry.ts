import type { Geometry, KoiElement, Page } from "@koi/core";

export function elementMap(page: Page): ReadonlyMap<string, KoiElement> {
  return new Map(page.elements.map((element) => [element.id, element]));
}

export function worldGeometry(
  element: KoiElement,
  elements: ReadonlyMap<string, KoiElement>,
  previewOffset?: (elementId: string) => { x: number; y: number },
): Geometry {
  const ownPreview = previewOffset?.(element.id);
  let x = element.geometry.x + (ownPreview?.x ?? 0);
  let y = element.geometry.y + (ownPreview?.y ?? 0);
  let parentId = element.parentId;
  const visited = new Set([element.id]);
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = elements.get(parentId);
    if (!parent) break;
    const parentPreview = previewOffset?.(parent.id);
    x += parent.geometry.x + (parentPreview?.x ?? 0);
    y += parent.geometry.y + (parentPreview?.y ?? 0);
    parentId = parent.parentId;
  }
  return { ...element.geometry, x, y };
}

export function intersects(left: Geometry, right: Geometry): boolean {
  return !(
    left.x + left.width < right.x ||
    right.x + right.width < left.x ||
    left.y + left.height < right.y ||
    right.y + right.height < left.y
  );
}

export function connectorAnchor(geometry: Geometry, anchor: string): { x: number; y: number } {
  switch (anchor) {
    case "top":
      return { x: geometry.x + geometry.width / 2, y: geometry.y };
    case "right":
      return { x: geometry.x + geometry.width, y: geometry.y + geometry.height / 2 };
    case "bottom":
      return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height };
    case "left":
      return { x: geometry.x, y: geometry.y + geometry.height / 2 };
    default:
      return {
        x: geometry.x + geometry.width / 2,
        y: geometry.y + geometry.height / 2,
      };
  }
}

export function connectorBounds(
  connector: Extract<KoiElement, { kind: "connector" }>,
  elements: ReadonlyMap<string, KoiElement>,
): Geometry | undefined {
  const fromElement = elements.get(connector.properties.from.elementId);
  const toElement = elements.get(connector.properties.to.elementId);
  if (!fromElement || !toElement) return undefined;
  const from = connectorAnchor(
    worldGeometry(fromElement, elements),
    connector.properties.from.anchor,
  );
  const to = connectorAnchor(worldGeometry(toElement, elements), connector.properties.to.anchor);
  const padding = connector.properties.strokeWidth / 2;
  return {
    x: Math.min(from.x, to.x) - padding,
    y: Math.min(from.y, to.y) - padding,
    width: Math.abs(to.x - from.x) + padding * 2,
    height: Math.abs(to.y - from.y) + padding * 2,
    rotation: 0,
  };
}
