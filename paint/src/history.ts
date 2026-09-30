import { Doc, Layer, Rect } from "./doc";

type Entry =
  | { kind: "pixels"; layerId: number; rect: Rect; before: ImageData; after: ImageData }
  | { kind: "struct"; before: Snapshot; after: Snapshot };

export interface Snapshot { layers: Layer[]; active: number }

const MAX_ENTRIES = 100;

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  onChange = () => {};
  constructor(private doc: Doc) {}

  reset(doc: Doc) { this.doc = doc; this.undoStack = []; this.redoStack = []; this.onChange(); }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private push(e: Entry) {
    this.undoStack.push(e);
    if (this.undoStack.length > MAX_ENTRIES) this.undoStack.shift();
    this.redoStack = [];
    this.doc.dirty = true;
    this.onChange();
  }

  pushPixels(layer: Layer, rect: Rect, before: ImageData) {
    const after = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    this.push({ kind: "pixels", layerId: layer.id, rect, before, after });
  }

  snapshot(): Snapshot {
    return { layers: this.doc.layers.map(l => this.doc.cloneLayer(l)), active: this.doc.active };
  }

  /** Call with a snapshot taken before a structural change (add/delete/merge/props). */
  pushStruct(before: Snapshot) {
    this.push({ kind: "struct", before, after: this.snapshot() });
  }

  private apply(e: Entry, forward: boolean) {
    if (e.kind === "pixels") {
      const l = this.doc.layers.find(l => l.id === e.layerId);
      if (l) l.ctx.putImageData(forward ? e.after : e.before, e.rect.x, e.rect.y);
    } else {
      const s = forward ? e.after : e.before;
      this.doc.layers = s.layers.map(l => this.doc.cloneLayer(l));
      this.doc.active = Math.min(s.active, this.doc.layers.length - 1);
    }
    this.doc.dirty = true;
  }

  undo() { const e = this.undoStack.pop(); if (!e) return; this.apply(e, false); this.redoStack.push(e); this.onChange(); }
  redo() { const e = this.redoStack.pop(); if (!e) return; this.apply(e, true); this.undoStack.push(e); this.onChange(); }
}
