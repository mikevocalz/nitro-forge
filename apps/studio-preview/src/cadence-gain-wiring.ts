import type { CadenceDocument } from '../../../packages/cadence/src/index';

/**
 * Engine side of NYC-Tron v1.0.0 E-14 VerticalFader. The fader commits linear
 * gain (0 is silence, 1 is 0 dB, the top of its default range), which is the
 * unit Cadence stores as track `volume` (0..1).
 */
export function commitCadenceTrackGain(document: Pick<CadenceDocument, 'setTrackGain'>, trackId: number, gain: number) {
  if (!Number.isSafeInteger(trackId) || trackId < 0) throw new RangeError('Not a Cadence track id');
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new RangeError('Track gain must be between silence and 0 dB.');
  return document.setTrackGain(trackId, gain);
}
