import type { DocumentHandle } from '@nitro-forge/ignition';
import { CADENCE_WAV_EXPORT, songEndTicks } from '../../../packages/cadence/src/transfer';

/** Keep JSON/base64 render results below the host's 32 MiB response budget.
 * The host's shared operation gate must own the document for this entire call. */
export async function exportCadenceWav(document: DocumentHandle): Promise<Uint8Array> {
  const result = await document.apply<{
    tempo_bpm: number; ppq: number;
    tracks: { clips: { start_ticks: number; length_ticks: number }[] }[];
  }>('describe', {});
  const project = result.data;
  const end = songEndTicks(project);
  const seconds = end / project.ppq * 60 / project.tempo_bpm;
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(project.ppq) || project.ppq <= 0 || !Number.isFinite(project.tempo_bpm) || project.tempo_bpm <= 0 || seconds > 60)
    throw new Error('This preview exports complete masters up to 60 seconds. Your project is unchanged.');
  // Reuse the actual renderer and continuous stateful insert processing.
  return CADENCE_WAV_EXPORT.run(document, undefined);
}
