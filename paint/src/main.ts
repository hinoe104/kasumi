import { Doc, Layer, Rect, BLEND_LABELS, Blend, makeCanvas, clipRect } from "./doc";
import { History, Snapshot } from "./history";
import { BrushTip, Stroke, PRESETS, BrushPreset, BrushSettings } from "./brush";
import { ColorPicker, fromHex } from "./color";
import { floodFill } from "./fill";
import * as io from "./io";
import { initPalettes, togglePalette, toggleAll, onToggle } from "./palette";

type Tool = "brush" | "eraser" | "fill" | "picker" | "hand";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/* ------------------------------------------------------------------ state */

let doc = createDoc(1920, 1080);
const history = new History(doc);
let tool: Tool = "brush";
let fg = "#000000", bg = "#ffffff";
let recent: string[] = [];
const presets: BrushPreset[] = loadPresets();
let brushPreset = 0;                                  // last non-eraser preset
const eraserPreset = presets.findIndex(p => p.eraser);
const tip = new BrushTip();

const view = { cx: 960, cy: 540, zoom: 1, rot: 0, flip: false };
const stage = $("#stage");
const canvas = $<HTMLCanvasElement>("#view");
const vctx = canvas.getContext("2d")!;
let needsRender = true;
let cursor: { x: number; y: number } | null = null;   // screen coords (CSS px)

function createDoc(w: number, h: number): Doc {
  const d = new Doc(w, h);
  const bgLayer = d.newLayer("用紙");
  bgLayer.ctx.fillStyle = "#ffffff";
  bgLayer.ctx.fillRect(0, 0, w, h);
  d.layers.push(bgLayer, d.newLayer("レイヤー1"));
  d.active = 1;
  return d;
}

function loadPresets(): BrushPreset[] {
  try {
    const saved = JSON.parse(localStorage.getItem("kasumi-paint:presets") ?? "null") as BrushPreset[] | null;
    if (saved && saved.length === PRESETS.length) return saved.map((p, i) => ({ ...PRESETS[i], settings: { ...PRESETS[i].settings, ...p.settings } }));
  } catch { /* ignore */ }
  return PRESETS.map(p => ({ ...p, settings: { ...p.settings } }));
}
const savePresets = () => { try { localStorage.setItem("kasumi-paint:presets", JSON.stringify(presets)); } catch { /* ignore */ } };

const currentPreset = () => presets[tool === "eraser" ? eraserPreset : brushPreset];

/* ------------------------------------------------------------------ view transform */

function viewMatrix(): DOMMatrix {
  const w = stage.clientWidth, h = stage.clientHeight;
  return new DOMMatrix()
    .translate(w / 2, h / 2)
    .rotate(view.rot)
    .scale(view.flip ? -view.zoom : view.zoom, view.zoom)
    .translate(-view.cx, -view.cy);
}
function screenToDoc(x: number, y: number) {
  const p = viewMatrix().inverse().transformPoint(new DOMPoint(x, y));
  return { x: p.x, y: p.y };
}
function stagePoint(e: { clientX: number; clientY: number }) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function zoomAt(factor: number, sx: number, sy: number) {
  const before = screenToDoc(sx, sy);
  view.zoom = Math.min(64, Math.max(0.02, view.zoom * factor));
  const after = screenToDoc(sx, sy);
  view.cx += before.x - after.x; view.cy += before.y - after.y;
  requestRender();
}
function fitView() {
  const w = stage.clientWidth, h = stage.clientHeight;
  view.zoom = Math.min((w - 40) / doc.width, (h - 40) / doc.height, 1);
  view.cx = doc.width / 2; view.cy = doc.height / 2; view.rot = 0;
  requestRender();
}

/* ------------------------------------------------------------------ rendering */

let checker: CanvasPattern | null = null;
function getChecker() {
  if (!checker) {
    const [c, ctx] = makeCanvas(16, 16);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#d6d6d6"; ctx.fillRect(0, 0, 8, 8); ctx.fillRect(8, 8, 8, 8);
    checker = vctx.createPattern(c, "repeat");
  }
  return checker!;
}

function requestRender() { needsRender = true; }

function render() {
  const dpr = devicePixelRatio;
  const w = Math.round(stage.clientWidth * dpr), h = Math.round(stage.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.clearRect(0, 0, w, h);
  const m = new DOMMatrix().scale(dpr, dpr).multiply(viewMatrix());

  // paper shadow + transparency checker
  vctx.setTransform(m);
  vctx.shadowColor = "rgba(0,0,0,.35)"; vctx.shadowBlur = 12 * dpr;
  vctx.fillStyle = getChecker();
  vctx.fillRect(0, 0, doc.width, doc.height);
  vctx.shadowColor = "transparent";

  vctx.imageSmoothingEnabled = view.zoom < 2;
  vctx.imageSmoothingQuality = "high";
  doc.composite(vctx, active ? { id: active.layer.id, canvas: active.work } : undefined);

  // brush cursor
  if (cursor && (tool === "brush" || tool === "eraser") && !panning && !spaceDown) {
    const s = currentPreset().settings;
    const r = Math.max(1.5, (s.size * view.zoom) / 2) * dpr;
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    const x = cursor.x * dpr, y = cursor.y * dpr;
    vctx.lineWidth = dpr;
    for (const [col, off] of [["rgba(0,0,0,.6)", 0.5], ["rgba(255,255,255,.8)", -0.5]] as const) {
      vctx.strokeStyle = col;
      vctx.beginPath(); vctx.arc(x, y, r + off * dpr, 0, Math.PI * 2); vctx.stroke();
    }
    vctx.fillStyle = "rgba(128,128,128,.9)"; vctx.fillRect(x - dpr / 2, y - dpr / 2, dpr, dpr);
  }
  $("#zoomLabel").textContent = `${Math.round(view.zoom * 100)}%`;
  $("#rotLabel").textContent = `${Math.round(((view.rot % 360) + 540) % 360 - 180)}°`;
}

function frame() {
  if (needsRender) { needsRender = false; render(); }
  requestAnimationFrame(frame);
}
new ResizeObserver(requestRender).observe(stage);

/* ------------------------------------------------------------------ painting */

interface ActiveStroke {
  layer: Layer;
  stroke: Stroke;
  buf: HTMLCanvasElement; bufCtx: CanvasRenderingContext2D;
  work: HTMLCanvasElement; workCtx: CanvasRenderingContext2D;
  eraser: boolean;
  settings: BrushSettings;
}
let active: ActiveStroke | null = null;
let lastStrokeEnd: { x: number; y: number } | null = null;
let strokeBuffers: [HTMLCanvasElement, CanvasRenderingContext2D, HTMLCanvasElement, CanvasRenderingContext2D] | null = null;

function buffers() {
  if (!strokeBuffers || strokeBuffers[0].width !== doc.width || strokeBuffers[0].height !== doc.height)
    strokeBuffers = [...makeCanvas(doc.width, doc.height), ...makeCanvas(doc.width, doc.height)];
  return strokeBuffers;
}

function beginStroke(x: number, y: number, p: number, eraser: boolean, straight: boolean) {
  const layer = doc.current;
  if (!layer.visible) { flash("非表示のレイヤーには描けません"); return; }
  const [buf, bufCtx, work, workCtx] = buffers();
  bufCtx.setTransform(1, 0, 0, 1, 0, 0);
  bufCtx.globalCompositeOperation = "source-over";
  bufCtx.clearRect(0, 0, doc.width, doc.height);
  workCtx.globalAlpha = 1; workCtx.globalCompositeOperation = "copy";
  workCtx.drawImage(layer.canvas, 0, 0);
  workCtx.globalCompositeOperation = "source-over";
  const settings = { ...currentPreset().settings };
  if (straight) settings.smoothing = 0;
  tip.update(settings.hardness, eraser ? "#000000" : fg);
  active = { layer, stroke: new Stroke(bufCtx, settings, tip), buf, bufCtx, work, workCtx, eraser, settings };
  if (straight && lastStrokeEnd) {
    moveStroke(lastStrokeEnd.x, lastStrokeEnd.y, p);
  }
  moveStroke(x, y, p);
  if (!eraser) pushRecent(fg);
}

function moveStroke(x: number, y: number, p: number) {
  if (!active) return;
  const r = active.stroke.add(x, y, p);
  if (r) updateWork(r);
}

function updateWork(r: Rect) {
  const a = active!;
  const c = clipRect(r, doc.width, doc.height);
  if (!c) return;
  const w = a.workCtx;
  // not "copy": that op clears the whole canvas outside the drawn rect
  w.globalAlpha = 1; w.globalCompositeOperation = "source-over";
  w.clearRect(c.x, c.y, c.w, c.h);
  w.drawImage(a.layer.canvas, c.x, c.y, c.w, c.h, c.x, c.y, c.w, c.h);
  w.globalAlpha = a.settings.opacity;
  w.globalCompositeOperation = a.eraser ? "destination-out" : a.layer.lockAlpha ? "source-atop" : "source-over";
  w.drawImage(a.buf, c.x, c.y, c.w, c.h, c.x, c.y, c.w, c.h);
  w.globalAlpha = 1; w.globalCompositeOperation = "source-over";
  requestRender();
}

function endStroke() {
  if (!active) return;
  const a = active;
  const tail = a.stroke.finish();
  if (tail) updateWork(tail);
  const b = a.stroke.bounds && clipRect(a.stroke.bounds, doc.width, doc.height);
  if (b) {
    const before = a.layer.ctx.getImageData(b.x, b.y, b.w, b.h);
    a.layer.ctx.save();
    a.layer.ctx.globalCompositeOperation = "copy";
    a.layer.ctx.beginPath(); a.layer.ctx.rect(b.x, b.y, b.w, b.h); a.layer.ctx.clip();
    a.layer.ctx.drawImage(a.work, 0, 0);
    a.layer.ctx.restore();
    history.pushPixels(a.layer, b, before);
  }
  active = null;
  requestRender();
}

function cancelStroke() { active = null; requestRender(); }

function pickColor(x: number, y: number) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
  const [, ctx] = makeCanvas(1, 1);
  ctx.setTransform(1, 0, 0, 1, -x, -y);
  doc.composite(ctx);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return;
  setFg("#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join(""));
}

function doFill(x: number, y: number) {
  const layer = doc.current;
  if (!layer.visible) { flash("非表示のレイヤーには描けません"); return; }
  const merged = ($("#fillMerged") as HTMLInputElement).checked;
  const src = (merged ? doc.flatten() : layer.canvas).getContext("2d")!.getImageData(0, 0, doc.width, doc.height);
  const before = layer.ctx.getImageData(0, 0, doc.width, doc.height);
  const tol = +($("#fillTol") as HTMLInputElement).value / 100;
  const expand = +($("#fillExpand") as HTMLInputElement).value;
  if (layer.lockAlpha) layer.ctx.globalCompositeOperation = "source-atop";
  const r = floodFill(src, layer.ctx, x, y, fromHex(fg)!, 1, tol, expand);
  layer.ctx.globalCompositeOperation = "source-over";
  if (!r) return;
  const full = { x: 0, y: 0, w: doc.width, h: doc.height };
  history.pushPixels(layer, r, cropImageData(before, full, r));
  pushRecent(fg);
  requestRender();
}

function cropImageData(src: ImageData, srcRect: Rect, r: Rect): ImageData {
  const out = new ImageData(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const s = ((y + r.y - srcRect.y) * srcRect.w + (r.x - srcRect.x)) * 4;
    out.data.set(src.data.subarray(s, s + r.w * 4), y * r.w * 4);
  }
  return out;
}

/* ------------------------------------------------------------------ input */

let spaceDown = false, altDown = false;
let panning: { mode: "pan" | "rotate"; x: number; y: number; cx: number; cy: number; rot: number; startAngle: number } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let gesture: { dist: number; angle: number; mid: { x: number; y: number }; zoom: number; rot: number; doc: { x: number; y: number } } | null = null;
let penSeen = false;
let drawingPointer: number | null = null;

function effectiveTool(e: PointerEvent): Tool {
  if (spaceDown || e.button === 1) return "hand";
  if (e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32))) return "eraser";
  if (altDown && (tool === "brush" || tool === "eraser" || tool === "fill")) return "picker";
  return tool;
}

function pressureOf(e: PointerEvent) {
  if (e.pointerType === "mouse") return 1;
  return e.pressure > 0 ? e.pressure : 0.01;
}

stage.addEventListener("pointerdown", e => {
  try { stage.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  const sp = stagePoint(e);
  if (e.pointerType === "pen") penSeen = true;

  if (e.pointerType === "touch") {
    touches.set(e.pointerId, sp);
    if (touches.size === 2) {
      if (active) cancelStroke();
      drawingPointer = null;
      startGesture();
      return;
    }
    if (penSeen) return; // with a pen around, a single finger doesn't draw
  }
  if (drawingPointer !== null || panning) return;

  const t = effectiveTool(e);
  const d = screenToDoc(sp.x, sp.y);
  if (t === "hand" || rotateKey || (e.button === 0 && e.shiftKey && e.ctrlKey)) {
    panning = { mode: e.shiftKey || e.ctrlKey || rotateKey ? "rotate" : "pan", x: sp.x, y: sp.y, cx: view.cx, cy: view.cy, rot: view.rot,
      startAngle: Math.atan2(sp.y - stage.clientHeight / 2, sp.x - stage.clientWidth / 2) };
    stage.style.cursor = "grabbing";
    return;
  }
  if (e.button !== 0 && !(e.pointerType === "pen" && t === "eraser")) return;
  if (t === "picker") { pickColor(d.x, d.y); drawingPointer = e.pointerId; return; }
  if (t === "fill") { doFill(d.x, d.y); return; }
  drawingPointer = e.pointerId;
  beginStroke(d.x, d.y, pressureOf(e), t === "eraser", e.shiftKey);
});

stage.addEventListener("pointermove", e => {
  const sp = stagePoint(e);
  if (e.pointerType === "touch" && touches.has(e.pointerId)) {
    touches.set(e.pointerId, sp);
    if (gesture) { updateGesture(); return; }
  }
  cursor = e.pointerType === "touch" ? null : sp;
  const d = screenToDoc(sp.x, sp.y);
  $("#statusPos").textContent = `${Math.floor(d.x)}, ${Math.floor(d.y)}`;

  if (panning) {
    if (panning.mode === "pan") {
      const inv = viewMatrix().inverse();
      const a = inv.transformPoint(new DOMPoint(panning.x, panning.y)), b = inv.transformPoint(new DOMPoint(sp.x, sp.y));
      view.cx += a.x - b.x; view.cy += a.y - b.y;
      panning.x = sp.x; panning.y = sp.y;
    } else {
      const ang = Math.atan2(sp.y - stage.clientHeight / 2, sp.x - stage.clientWidth / 2);
      view.rot = panning.rot + ((ang - panning.startAngle) * 180) / Math.PI;
    }
    requestRender();
    return;
  }
  if (drawingPointer === e.pointerId) {
    if (active) {
      // coalesced events give us the full tablet sampling rate (often 200Hz+)
      const evs = e.getCoalescedEvents?.() ?? [e];
      for (const ce of evs.length ? evs : [e]) {
        const p = stagePoint(ce), q = screenToDoc(p.x, p.y);
        moveStroke(q.x, q.y, pressureOf(ce));
      }
    } else if (effectiveTool(e) === "picker" || altDown || tool === "picker") {
      pickColor(d.x, d.y);
    }
  }
  requestRender();
});

function pointerEnd(e: PointerEvent) {
  touches.delete(e.pointerId);
  if (gesture && touches.size < 2) gesture = null;
  if (panning) { panning = null; stage.style.cursor = ""; updateCursorStyle(); }
  if (drawingPointer === e.pointerId) {
    drawingPointer = null;
    if (active) {
      const s = stagePoint(e), d = screenToDoc(s.x, s.y);
      lastStrokeEnd = d;
      if (e.type === "pointercancel") cancelStroke(); else endStroke();
    }
  }
}
stage.addEventListener("pointerup", pointerEnd);
stage.addEventListener("pointercancel", pointerEnd);
stage.addEventListener("pointerleave", () => { cursor = null; requestRender(); });
stage.addEventListener("contextmenu", e => e.preventDefault());

function startGesture() {
  const [a, b] = [...touches.values()];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  gesture = { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), mid, zoom: view.zoom, rot: view.rot, doc: screenToDoc(mid.x, mid.y) };
}
function updateGesture() {
  const g = gesture!;
  const [a, b] = [...touches.values()];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  view.zoom = Math.min(64, Math.max(0.02, g.zoom * Math.hypot(b.x - a.x, b.y - a.y) / g.dist));
  view.rot = g.rot + ((Math.atan2(b.y - a.y, b.x - a.x) - g.angle) * 180) / Math.PI;
  // keep the doc point that was under the fingers' midpoint under it
  const now = screenToDoc(mid.x, mid.y);
  view.cx += g.doc.x - now.x; view.cy += g.doc.y - now.y;
  requestRender();
}

stage.addEventListener("wheel", e => {
  e.preventDefault();
  const sp = stagePoint(e);
  if (e.shiftKey && !e.ctrlKey) { view.rot += e.deltaY > 0 ? 15 : -15; requestRender(); return; }
  zoomAt(Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 30 : 1)), sp.x, sp.y);
}, { passive: false });

let rotateKey = false;
function updateCursorStyle() {
  stage.style.cursor = spaceDown || tool === "hand" ? "grab"
    : (tool === "brush" || tool === "eraser") && !altDown ? "none"
    : "crosshair";
}

window.addEventListener("keydown", e => {
  if ((e.target as HTMLElement).matches("input:not([type=range]):not([type=checkbox]), select")) return;
  if (e.key === "Tab") { e.preventDefault(); toggleAll(); return; }
  if (e.code === "Space") { spaceDown = true; updateCursorStyle(); e.preventDefault(); return; }
  if (e.key === "Alt") { altDown = true; updateCursorStyle(); e.preventDefault(); return; }
  if (e.key === "r" && !e.ctrlKey) { rotateKey = true; }
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  const cmd =
    ctrl && k === "z" && !e.shiftKey ? "undo" :
    ctrl && (k === "y" || (k === "z" && e.shiftKey)) ? "redo" :
    ctrl && k === "s" && e.shiftKey ? "export" :
    ctrl && k === "s" ? "save" :
    ctrl && k === "o" ? "open" :
    ctrl && k === "n" && e.shiftKey ? "addLayer" :
    ctrl && k === "n" ? "new" :
    ctrl && k === "e" ? "mergeDown" :
    ctrl && k === "0" ? "fit" :
    ctrl && k === "1" ? "actual" :
    !ctrl && (k === "+" || k === ";" || k === "=") ? "zoomIn" :
    !ctrl && k === "-" ? "zoomOut" :
    !ctrl && k === "m" ? "flipView" :
    !ctrl && k === "delete" ? "clearLayer" : null;
  if (cmd) { e.preventDefault(); commands[cmd](); return; }
  if (ctrl) return;
  const tools: Record<string, Tool> = { b: "brush", e: "eraser", g: "fill", i: "picker", h: "hand" };
  if (tools[k]) { setTool(tools[k]); return; }
  if (k === "x") { [fg, bg] = [bg, fg]; setFg(fg); return; }
  if (k === "[" || k === "]") {
    const s = currentPreset().settings;
    s.size = Math.max(1, Math.min(500, Math.round(s.size * (k === "]" ? 1.15 : 1 / 1.15)) + (k === "]" ? 1 : 0)));
    savePresets(); renderBrushPanel(); requestRender();
  }
  if (/^[1-9]$/.test(k) && +k <= presets.length) selectPreset(+k - 1);
});
window.addEventListener("keyup", e => {
  if (e.code === "Space") { spaceDown = false; updateCursorStyle(); }
  if (e.key === "Alt") { altDown = false; updateCursorStyle(); e.preventDefault(); }
  if (e.key === "r") rotateKey = false;
});
window.addEventListener("blur", () => { spaceDown = altDown = rotateKey = false; updateCursorStyle(); });

/* ------------------------------------------------------------------ tools & brush UI */

function setTool(t: Tool) {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
  const brushy = t === "brush" || t === "eraser";
  $("#presets").hidden = t !== "brush"; $("#brushSliders").hidden = !brushy;
  $("#fillOptions").hidden = t !== "fill";
  $("#noOptions").hidden = brushy || t === "fill";
  $("#toolTitle").textContent = { brush: "ブラシ", eraser: "消しゴム", fill: "塗りつぶし", picker: "スポイト", hand: "手のひら" }[t];
  renderBrushPanel();
  updateCursorStyle();
  requestRender();
}
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => (b.onclick = () => setTool(b.dataset.tool as Tool)));

function selectPreset(i: number) {
  if (presets[i].eraser) { setTool("eraser"); return; }
  brushPreset = i;
  setTool("brush");
}

const SLIDERS: { key: keyof BrushSettings; label: string; min: number; max: number; step: number; fmt: (v: number) => string; log?: boolean }[] = [
  { key: "size", label: "サイズ", min: 1, max: 500, step: 0.1, fmt: v => v < 10 ? v.toFixed(1) : String(Math.round(v)), log: true },
  { key: "opacity", label: "濃度", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}` },
  { key: "flow", label: "流量", min: 0.01, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}` },
  { key: "hardness", label: "硬さ", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}` },
  { key: "minSize", label: "筆圧→太さ", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}` },
  { key: "minFlow", label: "筆圧→濃さ", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}` },
  { key: "pressureGamma", label: "筆圧カーブ", min: 0.3, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
  { key: "spacing", label: "間隔", min: 0.02, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}` },
  { key: "smoothing", label: "手ぶれ補正", min: 0, max: 20, step: 1, fmt: v => String(v) },
];

function renderBrushPanel() {
  const pr = $("#presets");
  pr.replaceChildren(...presets.flatMap((p, i) => {
    if (p.eraser) return [];
    const b = document.createElement("button");
    b.textContent = p.name;
    b.title = `${p.name} (${i + 1})`;
    b.classList.toggle("active", i === brushPreset);
    b.onclick = () => selectPreset(i);
    return [b];
  }));
  const s = currentPreset().settings;
  $("#brushSliders").replaceChildren(...SLIDERS.map(def => {
    const label = document.createElement("label");
    label.className = "slider";
    label.title = def.label;
    const span = document.createElement("span"); span.textContent = def.label;
    const input = document.createElement("input"); input.type = "range";
    const out = document.createElement("output");
    // size uses a log scale so small brushes are easy to dial in
    const toSlider = (v: number) => def.log ? Math.log(v / def.min) / Math.log(def.max / def.min) : v;
    const fromSlider = (v: number) => def.log ? def.min * Math.pow(def.max / def.min, v) : v;
    if (def.log) { input.min = "0"; input.max = "1"; input.step = "0.001"; }
    else { input.min = String(def.min); input.max = String(def.max); input.step = String(def.step); }
    input.value = String(toSlider(s[def.key]));
    out.textContent = def.fmt(s[def.key]);
    input.oninput = () => {
      let v = fromSlider(+input.value);
      if (def.key === "size") v = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
      s[def.key] = v; out.textContent = def.fmt(v); savePresets(); requestRender();
    };
    label.append(span, input, out);
    return label;
  }));
}

for (const id of ["fillTol", "fillExpand"]) {
  const input = $<HTMLInputElement>("#" + id), out = input.nextElementSibling as HTMLOutputElement;
  const upd = () => (out.textContent = input.value); input.oninput = upd; upd();
}

/* ------------------------------------------------------------------ color */

const picker = new ColorPicker($<HTMLCanvasElement>("#picker"));
picker.onChange = hex => setFg(hex, false);
function setFg(hex: string, updatePicker = true) {
  fg = hex;
  $("#fg").style.background = fg; $("#bg").style.background = bg;
  $<HTMLInputElement>("#hex").value = fg;
  if (updatePicker) picker.setHex(fg);
}
$<HTMLInputElement>("#hex").onchange = e => { const v = (e.target as HTMLInputElement).value; if (fromHex(v)) setFg(v.startsWith("#") ? v : "#" + v); };
$(".swatches").onclick = () => { [fg, bg] = [bg, fg]; setFg(fg); };
function pushRecent(c: string) {
  if (recent[0] === c) return;
  recent = [c, ...recent.filter(x => x !== c)].slice(0, 16);
  $("#recent").replaceChildren(...recent.map(c => {
    const d = document.createElement("div"); d.style.background = c; d.title = c; d.onclick = () => setFg(c); return d;
  }));
}

/* ------------------------------------------------------------------ layers */

const blendSel = $<HTMLSelectElement>("#blend");
blendSel.replaceChildren(...Object.entries(BLEND_LABELS).map(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; return o; }));

function structChange(fn: () => void) {
  const before: Snapshot = history.snapshot();
  fn();
  history.pushStruct(before);
  renderLayers(); requestRender();
}

function renderLayers() {
  const list = $("#layerList");
  const items = doc.layers.map((l, i) => {
    const li = document.createElement("li");
    li.classList.toggle("active", i === doc.active);
    const eye = document.createElement("span");
    eye.className = "eye" + (l.visible ? "" : " off"); eye.textContent = "👁"; eye.title = "表示/非表示";
    eye.onclick = ev => { ev.stopPropagation(); l.visible = !l.visible; doc.dirty = true; renderLayers(); requestRender(); };
    const thumb = document.createElement("canvas");
    thumb.width = 80; thumb.height = 60;
    const tctx = thumb.getContext("2d")!;
    const sc = Math.min(80 / doc.width, 60 / doc.height);
    tctx.drawImage(l.canvas, (80 - doc.width * sc) / 2, (60 - doc.height * sc) / 2, doc.width * sc, doc.height * sc);
    const name = document.createElement("span"); name.className = "name"; name.textContent = l.name;
    const meta = document.createElement("span"); meta.className = "meta";
    meta.textContent = `${Math.round(l.opacity * 100)}%${l.blend !== "source-over" ? " " + BLEND_LABELS[l.blend] : ""}${l.lockAlpha ? " 🔒" : ""}`;
    li.append(eye, thumb, name, meta);
    li.onclick = () => { doc.active = i; renderLayers(); };
    li.ondblclick = () => {
      const n = prompt("レイヤー名", l.name);
      if (n) { l.name = n; doc.dirty = true; renderLayers(); }
    };
    return li;
  }).reverse();
  list.replaceChildren(...items);
  const cur = doc.current;
  blendSel.value = cur.blend;
  const op = $<HTMLInputElement>("#layerOpacity");
  op.value = String(Math.round(cur.opacity * 100));
  (op.nextElementSibling as HTMLOutputElement).textContent = op.value + "%";
  $<HTMLInputElement>("#lockAlpha").checked = cur.lockAlpha;
  updateStatus();
}

blendSel.onchange = () => structChange(() => (doc.current.blend = blendSel.value as Blend));
{
  const op = $<HTMLInputElement>("#layerOpacity");
  let before: Snapshot | null = null;
  op.onpointerdown = () => (before = history.snapshot());
  op.oninput = () => { doc.current.opacity = +op.value / 100; (op.nextElementSibling as HTMLOutputElement).textContent = op.value + "%"; requestRender(); };
  op.onchange = () => { history.pushStruct(before ?? history.snapshot()); before = null; renderLayers(); };
}
$<HTMLInputElement>("#lockAlpha").onchange = e => structChange(() => (doc.current.lockAlpha = (e.target as HTMLInputElement).checked));

/* ------------------------------------------------------------------ commands */

let fileName = "無題";

const commands: Record<string, () => void | Promise<void>> = {
  undo: () => { history.undo(); requestRender(); },
  redo: () => { history.redo(); requestRender(); },
  zoomIn: () => zoomAt(1.25, stage.clientWidth / 2, stage.clientHeight / 2),
  zoomOut: () => zoomAt(0.8, stage.clientWidth / 2, stage.clientHeight / 2),
  fit: fitView,
  actual: () => { view.zoom = 1; requestRender(); },
  resetRot: () => { view.rot = 0; requestRender(); },
  flipView: () => { view.flip = !view.flip; $("#flipBtn").classList.toggle("active", view.flip); requestRender(); },
  theme: () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try { localStorage.setItem("kasumi-paint:theme", next); } catch { /* ignore */ }
  },
  addLayer: () => structChange(() => { doc.layers.splice(doc.active + 1, 0, doc.newLayer()); doc.active++; }),
  dupLayer: () => structChange(() => {
    const c = doc.cloneLayer(doc.current); const n = doc.newLayer(c.name + " コピー");
    n.ctx.drawImage(c.canvas, 0, 0); Object.assign(n, { opacity: c.opacity, blend: c.blend, visible: c.visible, lockAlpha: c.lockAlpha });
    doc.layers.splice(doc.active + 1, 0, n); doc.active++;
  }),
  delLayer: () => {
    if (doc.layers.length <= 1) return flash("最後のレイヤーは削除できません");
    structChange(() => { doc.layers.splice(doc.active, 1); doc.active = Math.max(0, doc.active - 1); });
  },
  mergeDown: () => {
    if (doc.active === 0) return flash("下にレイヤーがありません");
    structChange(() => {
      const top = doc.current, below = doc.layers[doc.active - 1];
      if (top.visible) {
        below.ctx.globalAlpha = top.opacity; below.ctx.globalCompositeOperation = top.blend;
        below.ctx.drawImage(top.canvas, 0, 0);
        below.ctx.globalAlpha = 1; below.ctx.globalCompositeOperation = "source-over";
      }
      doc.layers.splice(doc.active, 1); doc.active--;
    });
  },
  layerUp: () => { if (doc.active < doc.layers.length - 1) structChange(() => { const i = doc.active; [doc.layers[i], doc.layers[i + 1]] = [doc.layers[i + 1], doc.layers[i]]; doc.active++; }); },
  layerDown: () => { if (doc.active > 0) structChange(() => { const i = doc.active; [doc.layers[i], doc.layers[i - 1]] = [doc.layers[i - 1], doc.layers[i]]; doc.active--; }); },
  clearLayer: () => pixelOp(l => l.ctx.clearRect(0, 0, doc.width, doc.height)),
  flipLayer: () => pixelOp(l => {
    const [c, ctx] = makeCanvas(doc.width, doc.height); ctx.drawImage(l.canvas, 0, 0);
    l.ctx.clearRect(0, 0, doc.width, doc.height);
    l.ctx.setTransform(-1, 0, 0, 1, doc.width, 0); l.ctx.drawImage(c, 0, 0); l.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }),
  new: () => { $<HTMLDialogElement>("#newDialog").showModal(); },
  open: async () => {
    const f = await io.openFile(["kasumi", "png", "jpg", "jpeg", "webp", "bmp", "gif"]);
    if (!f) return;
    try {
      if (f.name.toLowerCase().endsWith(".kasumi")) {
        loadDoc(await io.deserialize(f.bytes), f.name.replace(/\.kasumi$/i, ""));
      } else {
        const img = await io.bytesToImage(f.bytes);
        const d = new Doc(img.width, img.height);
        const l = d.newLayer(f.name); l.ctx.drawImage(img, 0, 0);
        d.layers.push(l);
        loadDoc(d, f.name.replace(/\.[^.]+$/, ""));
      }
    } catch (err) { flash("開けませんでした: " + (err as Error).message); }
  },
  save: async () => {
    if (await io.saveBytes(await io.serialize(doc), fileName + ".kasumi", "kasumi", "Kasumi Paint")) { doc.dirty = false; flash("保存しました"); }
  },
  export: async () => {
    if (await io.saveBytes(await io.canvasToPng(doc.flatten()), fileName + ".png", "png", "PNG画像")) flash("PNGを書き出しました");
  },
};

function pixelOp(fn: (l: Layer) => void) {
  const l = doc.current;
  const before = l.ctx.getImageData(0, 0, doc.width, doc.height);
  fn(l);
  history.pushPixels(l, { x: 0, y: 0, w: doc.width, h: doc.height }, before);
  requestRender();
}

document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach(b => (b.onclick = () => commands[b.dataset.cmd!]()));
$("#zoomLabel").ondblclick = fitView;
$("#zoomLabel").onclick = () => { view.zoom = 1; requestRender(); };
$("#rotLabel").onclick = () => { view.rot = 0; requestRender(); };
document.querySelectorAll<HTMLButtonElement>("[data-win]").forEach(b => (b.onclick = () => togglePalette(b.dataset.win!)));
onToggle.fn = (id, open) => $(`[data-win="${id}"]`).classList.toggle("active", open);

$<HTMLDialogElement>("#newDialog").addEventListener("close", () => {
  const dlg = $<HTMLDialogElement>("#newDialog");
  if (dlg.returnValue !== "ok") return;
  const w = Math.max(1, Math.min(10000, +$<HTMLInputElement>("#newW").value || 1));
  const h = Math.max(1, Math.min(10000, +$<HTMLInputElement>("#newH").value || 1));
  loadDoc(createDoc(w, h), "無題");
});
document.querySelectorAll<HTMLButtonElement>("[data-size]").forEach(b => (b.onclick = () => {
  const [w, h] = b.dataset.size!.split("x");
  $<HTMLInputElement>("#newW").value = w; $<HTMLInputElement>("#newH").value = h;
}));

function loadDoc(d: Doc, name: string) {
  doc = d; fileName = name; active = null;
  history.reset(doc);
  fitView(); renderLayers();
}

history.onChange = () => {
  $<HTMLButtonElement>('[data-cmd="undo"]').disabled = !history.canUndo;
  $<HTMLButtonElement>('[data-cmd="redo"]').disabled = !history.canRedo;
  autosaveDirty = true;
  renderLayers();
};

/* ------------------------------------------------------------------ status & autosave */

let flashTimer = 0;
function flash(msg: string) {
  $("#statusMsg").textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => ($("#statusMsg").textContent = ""), 3000);
}
function updateStatus() {
  $("#statusDoc").textContent = `${fileName}${doc.dirty ? " *" : ""}  —  ${doc.width} × ${doc.height}  —  ${doc.current.name}`;
}

let autosaveDirty = false;
setInterval(async () => {
  if (!autosaveDirty || active) return;
  autosaveDirty = false;
  try { await io.autosaveWrite(await io.serialize(doc)); } catch { /* storage full etc. */ }
}, 30_000);

/* ------------------------------------------------------------------ boot */

(async () => {
  try {
    const t = localStorage.getItem("kasumi-paint:theme");
    if (t) document.documentElement.dataset.theme = t;
    else if (matchMedia("(prefers-color-scheme: light)").matches) document.documentElement.dataset.theme = "light";
  } catch { /* ignore */ }
  initPalettes({
    tools: { x: 12, y: 12 },
    color: { x: 12, y: 12, right: true },
    brush: { x: 12, y: 222, right: true },
    layers: { x: 260, y: 12, right: true },
  });
  setFg(fg);
  setTool("brush");
  history.onChange();
  fitView();
  requestAnimationFrame(frame);
  try {
    const saved = await io.autosaveRead();
    if (saved && confirm("前回の作業が自動保存されています。復元しますか？")) loadDoc(await io.deserialize(saved), "復元");
    else if (saved) await io.autosaveWrite(null);
  } catch { /* no autosave */ }
})();

