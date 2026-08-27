import type { Geometry } from "@koi/core";

import { intersects } from "../geometry.js";

const MAX_CELLS_PER_RECORD = 256;
const MAX_TOTAL_CELL_MEMBERSHIPS = 100_000;

interface CellBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  count: number;
}

export class SpatialIndex {
  readonly cellSize: number;
  #cells = new Map<string, Set<string>>();
  #records = new Map<string, Geometry>();
  #oversizedRecords = new Set<string>();
  #indexedCellMemberships = 0;

  constructor(cellSize = 1_024) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError("SpatialIndex cellSize must be positive and finite");
    }
    this.cellSize = cellSize;
  }

  set(id: string, geometry: Geometry): void {
    this.delete(id);
    this.#records.set(id, geometry);
    const bounds = this.#cellBounds(geometry);
    if (
      bounds.count > MAX_CELLS_PER_RECORD ||
      this.#indexedCellMemberships + bounds.count > MAX_TOTAL_CELL_MEMBERSHIPS
    ) {
      this.#oversizedRecords.add(id);
      return;
    }
    for (const key of this.#keysFor(bounds)) {
      const ids = this.#cells.get(key) ?? new Set<string>();
      ids.add(id);
      this.#cells.set(key, ids);
    }
    this.#indexedCellMemberships += bounds.count;
  }

  delete(id: string): void {
    const geometry = this.#records.get(id);
    if (!geometry) return;
    if (!this.#oversizedRecords.delete(id)) {
      const bounds = this.#cellBounds(geometry);
      for (const key of this.#keysFor(bounds)) {
        const ids = this.#cells.get(key);
        ids?.delete(id);
        if (ids?.size === 0) this.#cells.delete(key);
      }
      this.#indexedCellMemberships -= bounds.count;
    }
    this.#records.delete(id);
  }

  query(area: Geometry): string[] {
    const bounds = this.#cellBounds(area);
    const candidates = new Set<string>(this.#oversizedRecords);
    if (bounds.count > MAX_CELLS_PER_RECORD) {
      for (const id of this.#records.keys()) candidates.add(id);
    } else {
      for (const key of this.#keysFor(bounds)) {
        for (const id of this.#cells.get(key) ?? []) candidates.add(id);
      }
    }
    return [...candidates].filter((id) => intersects(this.#records.get(id)!, area));
  }

  #cellBounds(geometry: Geometry): CellBounds {
    const left = Math.floor(geometry.x / this.cellSize);
    const right = Math.floor((geometry.x + geometry.width) / this.cellSize);
    const top = Math.floor(geometry.y / this.cellSize);
    const bottom = Math.floor((geometry.y + geometry.height) / this.cellSize);
    return {
      left,
      right,
      top,
      bottom,
      count: (right - left + 1) * (bottom - top + 1),
    };
  }

  #keysFor(bounds: CellBounds): string[] {
    const keys: string[] = [];
    for (let y = bounds.top; y <= bounds.bottom; y += 1) {
      for (let x = bounds.left; x <= bounds.right; x += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }
}
