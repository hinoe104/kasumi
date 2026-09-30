/** Floating tool palettes: draggable by the title bar, closable, foldable, positions remembered. */

interface State { x: number; y: number; open: boolean; folded: boolean }
const KEY = "kasumi-paint:palettes";

let states: Record<string, State> = {};
try { states = JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { /* ignore */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(states)); } catch { /* ignore */ } };

let z = 10;
const palettes = new Map<string, HTMLElement>();
export const onToggle = { fn: (_id: string, _open: boolean) => {} };

function clamp(el: HTMLElement, s: State) {
  const area = el.parentElement!.getBoundingClientRect();
  s.x = Math.max(0, Math.min(area.width - 60, s.x));
  s.y = Math.max(0, Math.min(area.height - 28, s.y));
  el.style.left = s.x + "px"; el.style.top = s.y + "px";
}

function apply(id: string) {
  const el = palettes.get(id)!, s = states[id];
  el.hidden = !s.open;
  el.classList.toggle("folded", s.folded);
  clamp(el, s);
  onToggle.fn(id, s.open);
}

export function initPalettes(defaults: Record<string, { x: number; y: number; right?: boolean }>) {
  const area = document.querySelector<HTMLElement>("#workspace")!;
  const aw = area.clientWidth;
  document.querySelectorAll<HTMLElement>(".palette").forEach(el => {
    const id = el.dataset.palette!;
    palettes.set(id, el);
    const d = defaults[id] ?? { x: 40, y: 40 };
    states[id] ??= { x: d.right ? aw - el.offsetWidth - d.x : d.x, y: d.y, open: true, folded: false };

    const bar = el.querySelector<HTMLElement>(".titlebar")!;
    const close = document.createElement("button");
    close.className = "close"; close.textContent = "×"; close.title = "閉じる";
    close.onclick = () => setOpen(id, false);
    bar.append(close);

    el.addEventListener("pointerdown", () => (el.style.zIndex = String(++z)));
    bar.addEventListener("dblclick", e => {
      if ((e.target as HTMLElement).closest("button")) return;
      states[id].folded = !states[id].folded; apply(id); persist();
    });
    bar.addEventListener("pointerdown", e => {
      if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
      bar.setPointerCapture(e.pointerId);
      const s = states[id], ox = e.clientX - s.x, oy = e.clientY - s.y;
      const move = (ev: PointerEvent) => { s.x = ev.clientX - ox; s.y = ev.clientY - oy; clamp(el, s); };
      const up = () => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); persist(); };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
    apply(id);
  });
  new ResizeObserver(() => palettes.forEach((el, id) => clamp(el, states[id]))).observe(area);
}

export function setOpen(id: string, open: boolean) {
  states[id].open = open;
  if (open) palettes.get(id)!.style.zIndex = String(++z);
  apply(id); persist();
}
export const isOpen = (id: string) => states[id]?.open;
export function togglePalette(id: string) { setOpen(id, !isOpen(id)); }

/** Tab: hide/show every palette at once for a clean canvas. */
let stash: string[] | null = null;
export function toggleAll() {
  if (stash) { stash.forEach(id => setOpen(id, true)); stash = null; return; }
  stash = [...palettes.keys()].filter(isOpen);
  stash.forEach(id => setOpen(id, false));
}
