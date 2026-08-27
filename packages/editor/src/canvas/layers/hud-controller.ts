import type { Point } from "../camera/camera.js";

export class HudController {
  #canvas: HTMLCanvasElement | null = null;
  #context: CanvasRenderingContext2D | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #animationFrame: number | null = null;
  #animationWindow: Window | null = null;
  #pendingStroke: { points: readonly Point[]; color: string; width: number } | undefined;

  attach = (canvas: HTMLCanvasElement | null): void => {
    this.#cancelFrame();
    this.#resizeObserver?.disconnect();
    this.#canvas = canvas;
    this.#context = canvas?.getContext("2d") ?? null;
    if (!canvas) return;
    this.#resizeObserver = new ResizeObserver(() => this.resize());
    this.#resizeObserver.observe(canvas);
    this.resize();
  };

  resize(): void {
    const canvas = this.#canvas;
    const context = this.#context;
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    if (this.#pendingStroke) this.#scheduleDraw();
  }

  clear(): void {
    this.#pendingStroke = undefined;
    this.#cancelFrame();
    this.#clearNow();
  }

  drawStroke(points: readonly Point[], color = "#2659ff", width = 3): void {
    if (points.length < 2) return;
    this.#pendingStroke = { points, color, width };
    this.#scheduleDraw();
  }

  #clearNow(): void {
    const canvas = this.#canvas;
    const context = this.#context;
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    context.clearRect(0, 0, rect.width, rect.height);
  }

  #drawPending(): void {
    const stroke = this.#pendingStroke;
    const context = this.#context;
    if (!context || !stroke) return;
    this.#clearNow();
    context.beginPath();
    context.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
    for (let index = 1; index < stroke.points.length; index += 1) {
      const point = stroke.points[index]!;
      context.lineTo(point.x, point.y);
    }
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.stroke();
  }

  #scheduleDraw(): void {
    if (this.#animationFrame !== null) return;
    const view = this.#canvas?.ownerDocument.defaultView;
    if (!view) {
      this.#drawPending();
      return;
    }
    this.#animationWindow = view;
    this.#animationFrame = view.requestAnimationFrame(() => {
      this.#animationFrame = null;
      this.#animationWindow = null;
      this.#drawPending();
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
