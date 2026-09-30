import { Rect, unionRect } from "./doc";

export interface BrushSettings {
  size: number;        // diameter in px
  opacity: number;     // max stroke opacity (濃度), 0..1
  flow: number;        // per-dab alpha, 0..1
  hardness: number;    // 0 soft .. 1 hard
  spacing: number;     // fraction of diameter
  minSize: number;     // size at zero pressure, fraction
  minFlow: number;     // flow at zero pressure, fraction
  pressureGamma: number; // pressure curve (<1 = soft, >1 = hard)
  smoothing: number;   // 手ぶれ補正 0..20
}

export interface BrushPreset { name: string; eraser?: boolean; settings: BrushSettings }

const base: BrushSettings = {
  size: 6, opacity: 1, flow: 1, hardness: 0.9, spacing: 0.08,
  minSize: 0.2, minFlow: 1, pressureGamma: 1, smoothing: 3,
};

export const PRESETS: BrushPreset[] = [
  { name: "ペン", settings: { ...base } },
  { name: "鉛筆", settings: { ...base, size: 3, hardness: 1, minSize: 0.6, minFlow: 0.3, flow: 0.8, smoothing: 1 } },
  { name: "筆", settings: { ...base, size: 18, hardness: 0.7, minSize: 0.05, pressureGamma: 1.3, smoothing: 5 } },
  { name: "エアブラシ", settings: { ...base, size: 60, hardness: 0, flow: 0.08, opacity: 1, minSize: 1, minFlow: 0, spacing: 0.1, smoothing: 0 } },
  { name: "水彩", settings: { ...base, size: 30, hardness: 0.3, flow: 0.25, opacity: 0.6, minSize: 0.4, minFlow: 0.2, spacing: 0.06 } },
  { name: "消しゴム", eraser: true, settings: { ...base, size: 20, hardness: 0.8, minSize: 0.5 } },
];

const TIP_SIZES = [256, 64, 16];

/** Pre-rendered, tinted brush tips at several resolutions (poor-man's mipmaps). */
export class BrushTip {
  private tips: HTMLCanvasElement[] = [];
  private key = "";

  update(hardness: number, color: string) {
    const key = `${hardness.toFixed(3)}|${color}`;
    if (key === this.key) return;
    this.key = key;
    this.tips = TIP_SIZES.map(s => {
      const c = document.createElement("canvas");
      c.width = c.height = s;
      const ctx = c.getContext("2d")!;
      const img = ctx.createImageData(s, s);
      const r = s / 2;
      const aa = 1.2 / r; // ~1 texel antialiasing edge
      const h = Math.min(hardness, 1 - aa);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
        let a: number;
        if (d <= h) a = 1;
        else if (d >= 1) a = 0;
        else { const t = (d - h) / (1 - h); a = hardness > 0.98 ? 1 - t : (1 - t * t) * (1 - t * t); }
        img.data[(y * s + x) * 4 + 3] = Math.round(a * 255);
      }
      ctx.putImageData(img, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, s, s);
      return c;
    });
  }

  pick(diameter: number): HTMLCanvasElement {
    for (let i = TIP_SIZES.length - 1; i >= 0; i--) if (TIP_SIZES[i] >= diameter * 1.5) return this.tips[i];
    return this.tips[0];
  }
}

interface Pt { x: number; y: number; p: number }

/** Turns raw pointer samples into evenly-spaced dabs on a stroke buffer. */
export class Stroke {
  private sx = 0; private sy = 0; private sp = 0;   // smoothed position
  private last: Pt | null = null;
  private residual = 0;
  private raw: Pt | null = null;
  bounds: Rect | null = null;

  constructor(private ctx: CanvasRenderingContext2D, private s: BrushSettings, private tip: BrushTip) {}

  private pressure(p: number) { return Math.pow(Math.min(1, Math.max(0, p)), this.s.pressureGamma); }

  private dab(x: number, y: number, p: number): Rect {
    const s = this.s;
    const pp = this.pressure(p);
    let d = s.size * (s.minSize + (1 - s.minSize) * pp);
    let a = s.flow * (s.minFlow + (1 - s.minFlow) * pp);
    if (d < 1) { a *= d; d = 1; } // tiny dabs: fade instead of shrink below a pixel
    if (a <= 0) return { x, y, w: 0, h: 0 };
    this.ctx.globalAlpha = Math.min(1, a);
    const r = d / 2;
    this.ctx.drawImage(this.tip.pick(d), x - r, y - r, d, d);
    return { x: x - r - 1, y: y - r - 1, w: d + 2, h: d + 2 };
  }

  /** Returns the rect touched by this call, or null. */
  add(x: number, y: number, p: number): Rect | null {
    this.raw = { x, y, p };
    if (!this.last) {
      this.sx = x; this.sy = y; this.sp = p;
      this.last = { x, y, p };
      const r = this.dab(x, y, p);
      this.bounds = unionRect(this.bounds, r);
      return r;
    }
    const k = 1 / (1 + this.s.smoothing * 0.6);
    this.sx += (x - this.sx) * k; this.sy += (y - this.sy) * k; this.sp += (p - this.sp) * k;
    return this.segmentTo(this.sx, this.sy, this.sp);
  }

  /** Catch up to the final raw point so smoothing never shortens the line. */
  finish(): Rect | null {
    if (!this.raw || !this.last || this.s.smoothing === 0) return null;
    let dirty: Rect | null = null;
    for (let i = 0; i < 8; i++) {
      this.sx += (this.raw.x - this.sx) * 0.5; this.sy += (this.raw.y - this.sy) * 0.5;
      const r = this.segmentTo(this.sx, this.sy, this.sp * (1 - i / 8)); // taper at the end
      if (r) dirty = unionRect(dirty, r);
    }
    return dirty;
  }

  private segmentTo(x: number, y: number, p: number): Rect | null {
    const a = this.last!;
    const dist = Math.hypot(x - a.x, y - a.y);
    if (dist < 1e-6) { this.last = { x, y, p }; return null; }
    let dirty: Rect | null = null;
    let t = this.residual;
    while (true) {
      const pp = a.p + (p - a.p) * Math.min(1, t / dist);
      const d = this.s.size * (this.s.minSize + (1 - this.s.minSize) * this.pressure(pp));
      const step = Math.max(0.3, d * this.s.spacing);
      if (t > dist) { this.residual = t - dist; break; }
      const f = t / dist;
      dirty = unionRect(dirty, this.dab(a.x + (x - a.x) * f, a.y + (y - a.y) * f, pp));
      t += step;
    }
    this.last = { x, y, p };
    if (dirty) this.bounds = unionRect(this.bounds, dirty);
    return dirty;
  }
}
