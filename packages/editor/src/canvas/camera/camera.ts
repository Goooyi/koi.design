export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(point: Point, camera: Camera): Point {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}

export function screenToWorld(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

export function zoomAround(camera: Camera, screenPoint: Point, nextZoom: number): Camera {
  const worldPoint = screenToWorld(screenPoint, camera);
  const zoom = clampZoom(nextZoom);
  return {
    x: screenPoint.x - worldPoint.x * zoom,
    y: screenPoint.y - worldPoint.y * zoom,
    zoom,
  };
}

export function cameraCssTransform(camera: Camera): string {
  return `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`;
}

type CameraListener = (camera: Camera) => void;

export class CameraController {
  #camera: Camera;
  #world: HTMLElement | null = null;
  #listeners = new Set<CameraListener>();
  #animationFrame: number | null = null;
  #animationWindow: Window | null = null;

  constructor(initial: Camera = { x: 120, y: 96, zoom: 0.85 }) {
    this.#camera = initial;
  }

  get = (): Camera => this.#camera;

  attachWorld = (world: HTMLElement | null): void => {
    this.#cancelFrame();
    this.#world = world;
    this.#apply();
  };

  subscribe = (listener: CameraListener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set(next: Camera): void {
    this.#camera = { ...next, zoom: clampZoom(next.zoom) };
    this.#scheduleApply();
    for (const listener of this.#listeners) {
      listener(this.#camera);
    }
  }

  panBy(dx: number, dy: number): void {
    this.set({ ...this.#camera, x: this.#camera.x + dx, y: this.#camera.y + dy });
  }

  zoomAt(point: Point, factor: number): void {
    this.set(zoomAround(this.#camera, point, this.#camera.zoom * factor));
  }

  reset(): void {
    this.set({ x: 120, y: 96, zoom: 0.85 });
  }

  #apply(): void {
    if (this.#world) {
      this.#world.style.transform = cameraCssTransform(this.#camera);
    }
  }

  #scheduleApply(): void {
    if (this.#animationFrame !== null) return;
    const view = this.#world?.ownerDocument.defaultView;
    if (!view) {
      this.#apply();
      return;
    }
    this.#animationWindow = view;
    this.#animationFrame = view.requestAnimationFrame(() => {
      this.#animationFrame = null;
      this.#animationWindow = null;
      this.#apply();
    });
  }

  #cancelFrame(): void {
    if (this.#animationFrame !== null) {
      this.#animationWindow?.cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = null;
      this.#animationWindow = null;
    }
  }
}
