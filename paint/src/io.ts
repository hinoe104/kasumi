import { Doc, Layer, Blend } from "./doc";

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function saveBytes(bytes: Uint8Array, name: string, ext: string, label: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: name, filters: [{ name: label, extensions: [ext] }] });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

export async function openFile(accept: string[]): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, filters: [{ name: "対応ファイル", extensions: accept }] });
    if (!path || Array.isArray(path)) return null;
    return { name: path.split(/[\\/]/).pop()!, bytes: await readFile(path) };
  }
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.map(e => "." + e).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}

export function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((res, rej) => c.toBlob(async b => b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error("PNG変換失敗")), "image/png"));
}

export async function bytesToImage(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart]));
}

/* ---- project format (.kasumi): JSON with per-layer PNGs ---- */

interface ProjectLayer { name: string; visible: boolean; opacity: number; blend: Blend; lockAlpha: boolean; png: string }
interface Project { format: "kasumi-paint"; version: 1; width: number; height: number; active: number; layers: ProjectLayer[] }

async function toDataUrl(c: HTMLCanvasElement) {
  const b = await canvasToPng(c);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return "data:image/png;base64," + btoa(s);
}

export async function serialize(doc: Doc): Promise<Uint8Array> {
  const p: Project = {
    format: "kasumi-paint", version: 1, width: doc.width, height: doc.height, active: doc.active,
    layers: await Promise.all(doc.layers.map(async l => ({
      name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, lockAlpha: l.lockAlpha, png: await toDataUrl(l.canvas),
    }))),
  };
  return new TextEncoder().encode(JSON.stringify(p));
}

export async function deserialize(bytes: Uint8Array): Promise<Doc> {
  const p = JSON.parse(new TextDecoder().decode(bytes)) as Project;
  if (p.format !== "kasumi-paint") throw new Error("Kasumi Paint のファイルではありません");
  const doc = new Doc(p.width, p.height);
  for (const pl of p.layers) {
    const l: Layer = doc.newLayer(pl.name);
    Object.assign(l, { visible: pl.visible, opacity: pl.opacity, blend: pl.blend, lockAlpha: pl.lockAlpha });
    const img = new Image();
    img.src = pl.png;
    await img.decode();
    l.ctx.drawImage(img, 0, 0);
    doc.layers.push(l);
  }
  doc.active = Math.min(p.active, doc.layers.length - 1);
  return doc;
}

/* ---- crash-recovery autosave (IndexedDB) ---- */

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("kasumi-paint", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("autosave");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function autosaveWrite(bytes: Uint8Array | null) {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction("autosave", "readwrite");
    if (bytes) tx.objectStore("autosave").put(bytes, "doc"); else tx.objectStore("autosave").delete("doc");
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

export async function autosaveRead(): Promise<Uint8Array | null> {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction("autosave").objectStore("autosave").get("doc");
    r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error);
  });
}
