/**
 * Cadence export formats for the file export sheet (A-30). WAV is rendered
 * by one bounded engine render so stateful insert effects stay continuous.
 * Cancellation is checked before/after that render; it cannot interrupt it.
 */
import {
  NFD_EXPORT,
  NFD_IMPORT,
  TransferError,
  type ExportFormat,
  type ImportFormat,
} from "@nitro-forge/ignition/transfer";
import { base64ToBytes, type DocumentHandle } from "@nitro-forge/ignition";
import { OPS } from "./index";

/** Output rate of the WAV export. */
export const WAV_SAMPLE_RATE = 48_000;


interface DescribeShape {
  tempo_bpm: number;
  ppq: number;
  tracks: { clips: { start_ticks: number; length_ticks: number }[] }[];
}

/** End of the last clip, in ticks; 0 for an empty song. */
export function songEndTicks(d: DescribeShape): number {
  let end = 0;
  for (const t of d.tracks) for (const c of t.clips) end = Math.max(end, c.start_ticks + c.length_ticks);
  return end;
}

/** 32-bit float stereo RIFF/WAVE around interleaved f32le samples. */
export function wavFloat32Stereo(samples: Uint8Array, sampleRate: number): Uint8Array {
  const channels = 2;
  const out = new Uint8Array(44 + samples.length);
  const v = new DataView(out.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // WAVE_FORMAT_IEEE_FLOAT
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 4, true);
  v.setUint16(32, channels * 4, true);
  v.setUint16(34, 32, true);
  ascii(36, "data");
  v.setUint32(40, samples.length, true);
  out.set(samples, 44);
  return out;
}

export const CADENCE_WAV_EXPORT: ExportFormat = {
  id: "wav",
  label: "WAV audio (32-bit float, 48 kHz)",
  extension: "wav",
  mime: "audio/wav",
  metadataFields: [],
  async run(doc: DocumentHandle, _quality, signal) {
    const d = (await doc.apply<DescribeShape>(OPS.describe)).data;
    const end = songEndTicks(d);
    if(signal?.aborted)throw new TransferError('aborted','export cancelled');
    if(end===0)return wavFloat32Stereo(new Uint8Array(),WAV_SAMPLE_RATE);
    const rendered=await doc.apply<{samples_b64:string}>(OPS.render,{from_ticks:0,to_ticks:end,sample_rate:WAV_SAMPLE_RATE});
    const samples=base64ToBytes(rendered.data.samples_b64);
    return wavFloat32Stereo(samples, WAV_SAMPLE_RATE);
  },
};

export const CADENCE_EXPORT_FORMATS: readonly ExportFormat[] = [NFD_EXPORT, CADENCE_WAV_EXPORT];
export const CADENCE_IMPORT_FORMATS: readonly ImportFormat[] = [NFD_IMPORT];
