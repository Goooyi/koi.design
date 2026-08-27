import { useSyncExternalStore } from "react";

import type { KoiElement, Projection } from "@koi/core";

import type { EditorStore } from "./editor-store.js";

export function useProjection(store: EditorStore): Projection {
  return useSyncExternalStore(store.subscribe, store.getProjection, store.getProjection);
}

export function useElement(store: EditorStore, elementId: string): KoiElement | undefined {
  return useSyncExternalStore(
    (listener) => store.subscribeElement(elementId, listener),
    () => store.getElement(elementId),
    () => store.getElement(elementId),
  );
}

export function useSelection(store: EditorStore): readonly string[] {
  return useSyncExternalStore(store.subscribeSelection, store.getSelection, store.getSelection);
}

export function useInteractionLocked(store: EditorStore): boolean {
  return useSyncExternalStore(
    store.subscribe,
    store.getInteractionLocked,
    store.getInteractionLocked,
  );
}

export function usePreviewRevision(store: EditorStore): number {
  return useSyncExternalStore(
    store.subscribePreviews,
    store.getPreviewRevision,
    store.getPreviewRevision,
  );
}

export function useIsSelected(store: EditorStore, elementId: string): boolean {
  return useSyncExternalStore(
    store.subscribeSelection,
    () => store.getSelection().includes(elementId),
    () => store.getSelection().includes(elementId),
  );
}
