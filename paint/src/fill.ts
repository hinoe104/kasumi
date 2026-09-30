import { Rect } from "./doc";

/** Scanline flood fill. Samples `src` (merged or layer), paints into `dst`. Returns the touched rect. */
export function floodFill(src: ImageData, dst: CanvasRenderingContext2D, sx: number, sy: number,
                          rgb: [number, number, number], alpha: number, tolerance: number, expand: number): Rect | null {
  const { width: w, height: h, data } = src;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const i0 = (sy * w + sx) * 4;
  const t = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]];
  const tol = tolerance * 255;
  const match = (i: number) =>
    Math.abs(data[i] - t[0]) <= tol && Math.abs(data[i + 1] - t[1]) <= tol &&
    Math.abs(data[i + 2] - t[2]) <= tol && Math.abs(data[i + 3] - t[3]) <= tol;

  let mask = new Uint8Array(w * h);
  const stack = [sx, sy];
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!;
    let x = x0;
    while (x > 0 && !mask[y * w + x - 1] && match((y * w + x - 1) * 4)) x--;
    let up = false, down = false;
    for (; x < w && !mask[y * w + x] && match((y * w + x) * 4); x++) {
      mask[y * w + x] = 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (y > 0) { const m = !mask[(y - 1) * w + x] && match(((y - 1) * w + x) * 4); if (m && !up) stack.push(x, y - 1); up = m; }
      if (y < h - 1) { const m = !mask[(y + 1) * w + x] && match(((y + 1) * w + x) * 4); if (m && !down) stack.push(x, y + 1); down = m; }
    }
  }
  // grow the mask to hide antialiased line edges (領域拡張)
  for (let n = 0; n < expand; n++) {
    const next = mask.slice();
    for (let y = Math.max(0, minY - 1); y <= Math.min(h - 1, maxY + 1); y++)
      for (let x = Math.max(0, minX - 1); x <= Math.min(w - 1, maxX + 1); x++) {
        if (mask[y * w + x]) continue;
        if ((x > 0 && mask[y * w + x - 1]) || (x < w - 1 && mask[y * w + x + 1]) ||
            (y > 0 && mask[(y - 1) * w + x]) || (y < h - 1 && mask[(y + 1) * w + x])) next[y * w + x] = 1;
      }
    mask = next;
    minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1); maxX = Math.min(w - 1, maxX + 1); maxY = Math.min(h - 1, maxY + 1);
  }
  const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const out = dst.createImageData(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    if (!mask[(y + minY) * w + x + minX]) continue;
    const o = (y * rect.w + x) * 4;
    out.data[o] = rgb[0]; out.data[o + 1] = rgb[1]; out.data[o + 2] = rgb[2]; out.data[o + 3] = Math.round(alpha * 255);
  }
  const tmp = document.createElement("canvas");
  tmp.width = rect.w; tmp.height = rect.h;
  tmp.getContext("2d")!.putImageData(out, 0, 0);
  dst.drawImage(tmp, rect.x, rect.y);
  return rect;
}
