export type Blend =
  | "source-over" | "multiply" | "screen" | "overlay" | "lighter"
  | "darken" | "lighten" | "color-dodge" | "color-burn" | "soft-light" | "hard-light" | "difference";

export const BLEND_LABELS: Record<Blend, string> = {
  "source-over": "通常", multiply: "乗算", screen: "スクリーン", overlay: "オーバーレイ",
  lighter: "加算", darken: "比較(暗)", lighten: "比較(明)", "color-dodge": "覆い焼き",
  "color-burn": "焼き込み", "soft-light": "ソフトライト", "hard-light": "ハードライト", difference: "差の絶対値",
};

export interface Layer {
  id: number;
  name: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
  opacity: number;
  blend: Blend;
  lockAlpha: boolean;
}

export interface Rect { x: number; y: number; w: number; h: number }

let nextId = 1;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: false })!;
  return [c, ctx];
}

export class Doc {
  layers: Layer[] = [];
  active = 0;
  dirty = false;
  constructor(public width: number, public height: number) {}

  newLayer(name?: string): Layer {
    const [canvas, ctx] = makeCanvas(this.width, this.height);
    return { id: nextId++, name: name ?? `レイヤー${nextId - 1}`, canvas, ctx, visible: true, opacity: 1, blend: "source-over", lockAlpha: false };
  }

  cloneLayer(l: Layer): Layer {
    const n = this.newLayer(l.name);
    n.ctx.drawImage(l.canvas, 0, 0);
    n.id = l.id; n.visible = l.visible; n.opacity = l.opacity; n.blend = l.blend; n.lockAlpha = l.lockAlpha;
    return n;
  }

  get current(): Layer { return this.layers[this.active]; }

  /** Draws all layers onto ctx (caller sets transform). `override` swaps a layer's canvas for display. */
  composite(ctx: CanvasRenderingContext2D, override?: { id: number; canvas: HTMLCanvasElement }) {
    for (const l of this.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = l.blend;
      ctx.drawImage(override && override.id === l.id ? override.canvas : l.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  flatten(background: string | null = null): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(this.width, this.height);
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, this.width, this.height); }
    this.composite(ctx);
    return c;
  }
}

export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w)), y1 = Math.min(h, Math.ceil(r.y + r.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
