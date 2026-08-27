import type { Document, ElementKind, Geometry, KoiElement, Page } from "../document/schema.js";

export interface LocatedElement {
  page: Page;
  element: KoiElement;
}

export function getPage(document: Document, pageId: string): Page | undefined {
  return document.pages.find((page) => page.id === pageId);
}

export function locateElement(document: Document, elementId: string): LocatedElement | undefined {
  for (const page of document.pages) {
    const element = page.elements.find((candidate) => candidate.id === elementId);
    if (element) {
      return { page, element };
    }
  }
  return undefined;
}

export function getElement(document: Document, elementId: string): KoiElement | undefined {
  return locateElement(document, elementId)?.element;
}

export interface ListElementOptions {
  kinds?: ElementKind[];
  parentId?: string | null;
}

export function listElements(
  document: Document,
  pageId: string,
  options: ListElementOptions = {},
): KoiElement[] {
  const page = getPage(document, pageId);
  if (!page) {
    return [];
  }
  const kinds = options.kinds ? new Set(options.kinds) : undefined;
  return page.elements.filter(
    (element) =>
      (!kinds || kinds.has(element.kind)) &&
      (options.parentId === undefined || element.parentId === options.parentId),
  );
}

export function getChildren(
  document: Document,
  elementId: string,
  recursive = false,
): KoiElement[] {
  const location = locateElement(document, elementId);
  if (!location) {
    return [];
  }

  const childrenByParent = new Map<string, KoiElement[]>();
  for (const element of location.page.elements) {
    if (element.parentId !== null) {
      const siblings = childrenByParent.get(element.parentId) ?? [];
      siblings.push(element);
      childrenByParent.set(element.parentId, siblings);
    }
  }

  const result: KoiElement[] = [];
  const queue = [...(childrenByParent.get(elementId) ?? [])];
  for (let index = 0; index < queue.length; index++) {
    const child = queue[index]!;
    result.push(child);
    if (recursive) {
      queue.push(...(childrenByParent.get(child.id) ?? []));
    }
  }
  return result;
}

export function getAncestors(document: Document, elementId: string): KoiElement[] {
  const location = locateElement(document, elementId);
  if (!location) {
    return [];
  }
  const byId = new Map(location.page.elements.map((element) => [element.id, element]));
  const ancestors: KoiElement[] = [];
  let parentId = location.element.parentId;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent) {
      break;
    }
    ancestors.push(parent);
    parentId = parent.parentId;
  }
  return ancestors;
}

export function inspectElements(document: Document, elementIds: string[]): LocatedElement[] {
  const requested = new Set(elementIds);
  const result: LocatedElement[] = [];
  for (const page of document.pages) {
    for (const element of page.elements) {
      if (requested.has(element.id)) {
        result.push({ page, element });
      }
    }
  }
  return result;
}

export function getAxisAlignedBounds(geometry: Geometry): Geometry {
  if (geometry.rotation % 360 === 0) {
    return geometry;
  }
  const radians = (geometry.rotation * Math.PI) / 180;
  const width =
    Math.abs(geometry.width * Math.cos(radians)) + Math.abs(geometry.height * Math.sin(radians));
  const height =
    Math.abs(geometry.width * Math.sin(radians)) + Math.abs(geometry.height * Math.cos(radians));
  return {
    x: geometry.x + (geometry.width - width) / 2,
    y: geometry.y + (geometry.height - height) / 2,
    width,
    height,
    rotation: 0,
  };
}

export function rectsIntersect(left: Geometry, right: Geometry): boolean {
  const leftBounds = getAxisAlignedBounds(left);
  const rightBounds = getAxisAlignedBounds(right);
  return !(
    leftBounds.x + leftBounds.width < rightBounds.x ||
    rightBounds.x + rightBounds.width < leftBounds.x ||
    leftBounds.y + leftBounds.height < rightBounds.y ||
    rightBounds.y + rightBounds.height < leftBounds.y
  );
}

export function queryElementsInRect(
  document: Document,
  pageId: string,
  rect: Geometry,
): KoiElement[] {
  return listElements(document, pageId).filter((element) => rectsIntersect(element.geometry, rect));
}
