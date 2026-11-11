import type { PrismDocument } from '../../../packages/prism/src/index';

/*
 * Engine side of NYC-Tron v1.0.0 C-11 EyedropperTool. The request and sample
 * shapes mirror `EyedropperRequest` and `SampledColor` structurally so this
 * module runs without the UI package.
 */

/** v1.0.0 `EyedropperRequest`. */
export interface EyedropperRequestShape {
  readonly documentId: string; readonly revision: string; readonly sourceId: string;
  readonly x: number; readonly y: number; readonly radius: number;
}
/** v1.0.0 `SampledColor`. */
export interface SampledColorShape {
  readonly profileId: string; readonly channels: readonly number[]; readonly alpha: number;
  readonly preview: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };
}
export interface EyedropperIdentity { readonly documentId: string; readonly revision: string }

/** `samplePixels` reads only the flattened composite, so it is the one source offered. */
export const PRISM_SAMPLE_SOURCES = [{ id: 'composite', label: 'Flattened image' }] as const;
/**
 * Prism composites 8-bit RGBA with no ICC handling, so the profile names the
 * engine's channel space instead of claiming sRGB.
 */
export const PRISM_SAMPLE_PROFILE = 'prism-rgba8';

function assertCurrent(request: EyedropperRequestShape, identity: () => EyedropperIdentity) {
  const now = identity();
  if (request.documentId !== now.documentId || request.revision !== now.revision)
    throw new Error('The image changed after this sample point was chosen. Sample again.');
}

/** EyedropperTool `onSample`: one read-only `samplePixels` call. */
export async function samplePrismColor(
  document: Pick<PrismDocument, 'samplePixels'>,
  request: EyedropperRequestShape,
  identity: () => EyedropperIdentity,
): Promise<SampledColorShape> {
  assertCurrent(request, identity);
  if (request.sourceId !== PRISM_SAMPLE_SOURCES[0].id) throw new RangeError('Prism samples the flattened image only.');
  const { r, g, b, a } = (await document.samplePixels(request.x, request.y, request.radius)).data;
  // A result for an older revision must not be offered for Apply.
  assertCurrent(request, identity);
  const alpha = a / 255;
  return { profileId: PRISM_SAMPLE_PROFILE, channels: [r, g, b], alpha, preview: { r, g, b, alpha } };
}

/**
 * EyedropperTool `onApply`. Validation and the revision check run now, at the
 * click; the returned write is one `setColors` on the active slot. The check
 * cannot run inside the write, because the surface re-renders as busy (a new
 * generation) before its write lock runs the action.
 */
export function prismSampledColorWrite(
  document: Pick<PrismDocument, 'setColors'>,
  sample: SampledColorShape,
  request: EyedropperRequestShape,
  identity: () => EyedropperIdentity,
  slot: 'foreground' | 'background',
) {
  assertCurrent(request, identity);
  const [r, g, b] = sample.channels;
  if (sample.profileId !== PRISM_SAMPLE_PROFILE || sample.channels.length !== 3 || ![r, g, b].every(v => Number.isInteger(v) && v! >= 0 && v! <= 255))
    throw new RangeError('Only a Prism sample can be applied to a Prism color.');
  if (!Number.isFinite(sample.alpha) || sample.alpha < 0 || sample.alpha > 1) throw new RangeError('Sample alpha must be 0..1');
  const color: [number, number, number, number] = [r!, g!, b!, Math.round(sample.alpha * 255)];
  return () => document.setColors(slot === 'foreground' ? { foreground: color } : { background: color });
}
