import { inspectElements, type JsonObject, type JsonValue, type Projection } from "@koi/core";

export const MAX_WEBMCP_OUTPUT_BYTES = 1_000_000;
const MAX_PREVIEW_DEPTH = 5;
const MAX_PREVIEW_NODES = 192;
const MAX_PREVIEW_KEYS = 32;
const MAX_PREVIEW_ARRAY_ITEMS = 64;
const MAX_PREVIEW_STRING_LENGTH = 1_024;

interface PreviewBudget {
  nodes: number;
  truncated: boolean;
}

function previewJson(value: JsonValue, budget: PreviewBudget, depth = 0): JsonValue {
  budget.nodes += 1;
  if (budget.nodes > MAX_PREVIEW_NODES || depth > MAX_PREVIEW_DEPTH) {
    budget.truncated = true;
    return "[truncated]";
  }
  if (typeof value === "string") {
    if (value.length <= MAX_PREVIEW_STRING_LENGTH) return value;
    budget.truncated = true;
    return `${value.slice(0, MAX_PREVIEW_STRING_LENGTH)}…`;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    if (value.length > MAX_PREVIEW_ARRAY_ITEMS) budget.truncated = true;
    return value
      .slice(0, MAX_PREVIEW_ARRAY_ITEMS)
      .map((item) => previewJson(item, budget, depth + 1));
  }

  const result: JsonObject = {};
  const entries = Object.entries(value);
  if (entries.length > MAX_PREVIEW_KEYS) budget.truncated = true;
  for (const [key, item] of entries.slice(0, MAX_PREVIEW_KEYS)) {
    result[key] = previewJson(item, budget, depth + 1);
  }
  return result;
}

export function createWebMcpElementPreviews(
  document: Projection["document"],
  elementIds: string[],
) {
  const locations = inspectElements(document, elementIds);
  const foundIds = new Set(locations.map(({ element }) => element.id));
  const elements = locations.map(({ page, element }) => {
    const budget: PreviewBudget = { nodes: 0, truncated: false };
    const properties = previewJson(element.properties, budget);
    if (properties === null || Array.isArray(properties) || typeof properties !== "object") {
      throw new Error(`Element ${element.id} properties did not produce an object preview`);
    }
    return {
      id: element.id,
      pageId: page.id,
      pageName: page.name,
      kind: element.kind,
      version: element.version,
      ...(element.name ? { name: element.name } : {}),
      parentId: element.parentId,
      geometry: element.geometry,
      properties,
      truncated: budget.truncated,
    };
  });
  return { elements, missingIds: elementIds.filter((id) => !foundIds.has(id)) };
}

export function outputExceedsWebMcpLimit(value: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_WEBMCP_OUTPUT_BYTES;
}
