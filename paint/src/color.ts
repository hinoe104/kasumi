export interface HSV { h: number; s: number; v: number }

export function hsvToRgb({ h, s, v }: HSV): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map(x => Math.round(x * 255)) as [number, number, number];
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export const toHex = (rgb: number[]) => "#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

/** HSV square + hue strip, drawn on one canvas. */
export class ColorPicker {
  hsv: HSV = { h: 0, s: 0, v: 0 };
  onChange = (_hex: string) => {};
  private ctx: CanvasRenderingContext2D;
  private drag: "sv" | "hue" | null = null;
  private readonly strip = 18;
  private readonly gap = 8;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("pointerdown", e => {
      canvas.setPointerCapture(e.pointerId);
      const { x } = this.local(e);
      this.drag = x > this.sq ? "hue" : "sv";
      this.move(e);
    });
    canvas.addEventListener("pointermove", e => { if (this.drag) this.move(e); });
    canvas.addEventListener("pointerup", () => (this.drag = null));
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  get hex() { return toHex(hsvToRgb(this.hsv)); }
  private get sq() { return this.canvas.clientWidth - this.strip - this.gap; }
  private local(e: PointerEvent) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private move(e: PointerEvent) {
    const { x, y } = this.local(e);
    const h = this.canvas.clientHeight;
    const c = (v: number) => Math.min(1, Math.max(0, v));
    if (this.drag === "hue") this.hsv.h = c(y / h) * 359.9;
    else { this.hsv.s = c(x / this.sq); this.hsv.v = 1 - c(y / h); }
    this.draw();
    this.onChange(this.hex);
  }

  setHex(hex: string) {
    const rgb = fromHex(hex);
    if (!rgb) return;
    const n = rgbToHsv(...rgb);
    if (n.s === 0 || n.v === 0) n.h = this.hsv.h; // keep hue on greys
    this.hsv = n;
    this.draw();
  }

  draw() {
    const dpr = devicePixelRatio, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    const ctx = this.ctx, sq = this.sq;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `hsl(${this.hsv.h},100%,50%)`; ctx.fillRect(0, 0, sq, h);
    let g = ctx.createLinearGradient(0, 0, sq, 0); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, sq, h);
    g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "#000");
    ctx.fillStyle = g; ctx.fillRect(0, 0, sq, h);
    const hx = sq + this.gap;
    g = ctx.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    ctx.fillStyle = g; ctx.fillRect(hx, 0, this.strip, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.hsv.v > 0.5 && this.hsv.s < 0.5 ? "#000" : "#fff";
    ctx.beginPath(); ctx.arc(this.hsv.s * sq, (1 - this.hsv.v) * h, 6, 0, Math.PI * 2); ctx.stroke();
    const hy = (this.hsv.h / 360) * h;
    ctx.strokeStyle = "#fff"; ctx.strokeRect(hx - 1, hy - 3, this.strip + 2, 6);
  }
}
