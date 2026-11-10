export type CanvasPoint = { x: number; y: number };
export type CanvasRect = CanvasPoint & { width: number; height: number };
export type CanvasShape = { kind: string; x: number; y: number; w: number; h: number; fill: readonly number[] };
export type CanvasLayer = { id: number; visible: boolean; opacity: number; content: { type: string; shape?: CanvasShape; pixels_b64?: string } };
export type CanvasDocument = { width: number; height: number; layers: readonly CanvasLayer[] };
const finite = (...values: number[]) => values.every(Number.isFinite);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Read one byte without allocating/decoding a canvas-sized raster on every tap. */
function alphaAt(base64: string | undefined, byte: number): number | null {
  if (typeof base64 !== 'string' || !Number.isSafeInteger(byte) || byte < 0) return null;
  const offset = Math.floor(byte / 3) * 4;
  const a = alphabet.indexOf(base64[offset] ?? '?');
  const b = alphabet.indexOf(base64[offset + 1] ?? '?');
  const c = alphabet.indexOf(base64[offset + 2] ?? '?');
  const d = alphabet.indexOf(base64[offset + 3] ?? '?');
  const part = byte % 3;
  if (a < 0 || b < 0 || (part >= 1 && c < 0) || (part === 2 && d < 0)) return null;
  return part === 0 ? ((a << 2) | (b >> 4)) & 255
    : part === 1 ? ((b << 4) | (c >> 2)) & 255 : ((c << 6) | d) & 255;
}

export function canvasPoint(document: CanvasDocument, viewport: CanvasRect, point: CanvasPoint): CanvasPoint | null {
  if (!finite(document.width, document.height, viewport.x, viewport.y, viewport.width, viewport.height, point.x, point.y)
    || document.width <= 0 || document.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const x = (point.x - viewport.x) * document.width / viewport.width;
  const y = (point.y - viewport.y) * document.height / viewport.height;
  return finite(x, y) ? { x, y } : null;
}

/** Select the topmost rendered pixel, including raster occlusion and transparent layers. */
export function hitCanvas(document: CanvasDocument, point: CanvasPoint): CanvasLayer | null {
  if (!finite(point.x, point.y) || point.x < 0 || point.y < 0 || point.x >= document.width || point.y >= document.height) return null;
  // Match the Rust rasterizer's pixel-center coverage, not unrelated overlay bounds.
  const x = Math.floor(point.x) + .5, y = Math.floor(point.y) + .5;
  for (let index = document.layers.length - 1; index >= 0; index--) {
    const layer = document.layers[index]!;
    if (!layer.visible || !Number.isFinite(layer.opacity) || layer.opacity <= 0) continue;
    if (layer.content.type === 'raster') {
      const alpha = alphaAt(layer.content.pixels_b64, (Math.floor(point.y) * document.width + Math.floor(point.x)) * 4 + 3);
      if (alpha === null) return null; // Unknown raster coverage must not select through it.
      if (alpha > 0) return layer;
    } else if (layer.content.type === 'shape') {
      const shape = layer.content.shape;
      if (!shape || !finite(shape.x, shape.y, shape.w, shape.h) || shape.w <= 0 || shape.h <= 0 || !(shape.fill[3]! > 0)) continue;
      if (shape.kind === 'rect' && x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h) return layer;
      if (shape.kind === 'ellipse') {
        const dx = (x - (shape.x + shape.w / 2)) / (shape.w / 2);
        const dy = (y - (shape.y + shape.h / 2)) / (shape.h / 2);
        if (dx * dx + dy * dy <= 1) return layer;
      }
    }
  }
  return null;
}

export function shapeDrag(document: CanvasDocument, viewport: CanvasRect, start: CanvasPoint, end: CanvasPoint) {
  if (!finite(start.x, start.y, end.x, end.y) || Math.hypot(end.x - start.x, end.y - start.y) < 4) return null;
  const from = canvasPoint(document, viewport, start), to = canvasPoint(document, viewport, end);
  if (!from || !to) return null;
  const dx = (end.x - start.x) * document.width / viewport.width;
  const dy = (end.y - start.y) * document.height / viewport.height;
  return finite(dx, dy) ? { dx, dy } : null;
}

/** View-only outline. It never substitutes for the engine's composite. */
export function shapeOutline(document: CanvasDocument, width: number, height: number, layer: CanvasLayer | undefined, delta = { dx: 0, dy: 0 }): CanvasRect | null {
  const shape = layer?.content.type === 'shape' ? layer.content.shape : undefined;
  if (!shape || !layer?.visible || !(layer.opacity > 0) || document.width <= 0 || document.height <= 0) return null;
  const x = (shape.x + delta.dx) * width / document.width, y = (shape.y + delta.dy) * height / document.height;
  const w = shape.w * width / document.width, h = shape.h * height / document.height;
  if (!finite(x, y, w, h) || w <= 0 || h <= 0) return null;
  // Bound style coordinates to the visible artboard (huge/off-canvas shapes are valid).
  const left = Math.max(0, x), top = Math.max(0, y);
  const right = Math.min(width, x + w), bottom = Math.min(height, y + h);
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/** Native measurement is already window-space. Web page events include scrolling. */
export function windowToPageRect(rect: CanvasRect, scroll: CanvasPoint): CanvasRect | null {
  const x = rect.x + scroll.x, y = rect.y + scroll.y;
  return finite(x, y, rect.width, rect.height) && rect.width > 0 && rect.height > 0 ? { ...rect, x, y } : null;
}

export type CanvasPreview = { id: number; dx: number; dy: number } | null;
type Context = { document: CanvasDocument; width: number; height: number; disabled: boolean; selectedId: number | null };
type Session = { released: boolean; selection: number | null; context: Context; start: CanvasPoint; end: CanvasPoint; layer: CanvasLayer | null; measured: Promise<CanvasRect | null>; rect: CanvasRect | null };
/** Bounded start/release measurement and one commit per gesture, never a document store. */
export function createCanvasGesture(callbacks: {
  context: () => Context; measure: () => Promise<CanvasRect | null>;
  select: (id: number | null) => void; preview: (value: CanvasPreview) => void;
  commit: (id: number, dx: number, dy: number) => void;
}) {
  let session: Session | null = null;
  const valid = (s: Session) => {
    const context = callbacks.context();
    return session === s && context.selectedId === s.selection && !context.disabled && context.document === s.context.document
      && context.width === s.context.width && context.height === s.context.height;
  };
  const cancel = () => { session = null; callbacks.preview(null); };
  const update = (s: Session) => {
    if (!valid(s) || !s.rect || s.layer?.content.type !== 'shape') return;
    const delta = shapeDrag(s.context.document, s.rect, s.start, s.end);
    callbacks.preview(delta ? { id: s.layer.id, ...delta } : null);
  };
  return {
    begin(point: CanvasPoint) {
      cancel();
      const context = callbacks.context();
      if (context.disabled) return;
      const s: Session = { released: false, selection: context.selectedId, context, start: point, end: point, layer: null, rect: null, measured: Promise.resolve(null) };
      session = s;
      s.measured = Promise.resolve().then(callbacks.measure).catch(() => null).then(rect => {
        if (!valid(s) || !rect) return null;
        s.rect = rect;
        const location = canvasPoint(context.document, rect, point);
        s.layer = location ? hitCanvas(context.document, location) : null;
        s.selection = s.layer?.id ?? null;
        callbacks.select(s.selection);
        update(s);
        return rect;
      });
    },
    move(point: CanvasPoint, touches = 1) {
      const s = session;
      if (!s || s.released) return;
      if (touches !== 1 || !valid(s)) { cancel(); return; }
      s.end = point;
      update(s);
    },
    async release(point: CanvasPoint) {
      const s = session;
      if (!s || s.released) return;
      s.released = true;
      s.end = point;
      const rect = await s.measured;
      if (!valid(s)) return;
      const releaseRect = rect ? await Promise.resolve().then(callbacks.measure).catch(() => null) : null;
      if (!valid(s)) return;
      if (!rect || !releaseRect || rect.x !== releaseRect.x || rect.y !== releaseRect.y
        || rect.width !== releaseRect.width || rect.height !== releaseRect.height) { cancel(); return; }
      const delta = s.layer?.content.type === 'shape' ? shapeDrag(s.context.document, rect, s.start, s.end) : null;
      cancel(); // Consume before commit, including repeated releases waiting on measurement.
      if (delta && s.layer) callbacks.commit(s.layer.id, delta.dx, delta.dy);
    },
    selectionChanged(id: number | null) { if (session && session.selection !== id) cancel(); },
    cancel,
  };
}
