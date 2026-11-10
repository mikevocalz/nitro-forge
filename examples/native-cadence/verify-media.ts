import { File, Paths } from "expo-file-system";
import { createPlatformMediaDecoder } from "@nyc-tron/platform-services/media";

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Real local codec fixture, installed into this lab's private cache by the acceptance runner. */
export async function verifyNativeMedia(): Promise<string> {
  const source = new File(Paths.cache, "P03-decoder.mp4");
  check(source.exists, "Generated media fixture is missing");
  const decoder = createPlatformMediaDecoder();
  check(decoder.isAvailable, "Native decoder is not linked");
  try {
    const probe = await decoder.probe(source.uri);
    check(probe.video?.width === 192 && probe.video.height === 128 && probe.audio?.channels === 1,
      "Native track metadata differs from the fixture");
    check(probe.durationUs >= 1_900_000 && probe.durationUs <= 2_100_000, "Unexpected duration");
    const frame = await decoder.decodeFrame(source.uri, { timeUs: 125_000, maxWidth: 96, maxHeight: 64 });
    check(frame.timing === "presentation" && frame.actualTimeUs >= 100_000 && frame.actualTimeUs <= 150_000,
      "Frame did not return its native presentation timestamp");
    check(frame.width === 96 && frame.height === 64 && new File(frame.uri).size > 100, "Decoded JPEG is missing or incorrectly scaled");
    const audio = await decoder.decodeAudio(source.uri, { startUs: 250_000, durationUs: 500_000, sampleRate: 24000 });
    check(audio.sampleRate === 24000 && audio.channels === 1 && Math.abs(audio.frames - 12000) <= 2,
      `Resampled PCM span differs: ${audio.sampleRate}Hz/${audio.channels}ch/${audio.frames}frames`);
    if (audio.pcm.kind !== "file") throw Error("Native PCM must remain file-backed");
    const bytes = await new File(audio.pcm.uri).bytes();
    check(bytes.length === audio.frames * 4 && bytes.length === audio.pcm.byteLength, "PCM framing mismatch");
    const samples = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let peak = 0, crossings = 0, previous = 0;
    for (let index = 0; index < audio.frames; index++) {
      const sample = samples.getFloat32(index * 4, true);
      check(Number.isFinite(sample), "Non-finite PCM sample");
      peak = Math.max(peak, Math.abs(sample));
      if (index && (sample >= 0) !== (previous >= 0)) crossings++;
      previous = sample;
    }
    check(peak > .05 && peak < .3 && crossings >= 420 && crossings <= 460,
      "Decoded PCM does not contain the generated 440 Hz tone");
    let code: unknown;
    try { await decoder.decodeFrame(source.uri, { timeUs: 9_000_000 }); } catch (error) { code = (error as { code?: unknown }).code; }
    check(code === "out-of-range", "Past-end frame did not reject with a typed error");
    await decoder.clearCache();
    check(!new File(frame.uri).exists && !new File(audio.pcm.uri).exists, "Decoder cache retained outputs");
    return `Native media passed: ${probe.video.width}x${probe.video.height}; frame ${frame.actualTimeUs}us ${frame.width}x${frame.height}; PCM ${audio.frames} frames at ${audio.sampleRate}Hz, ${crossings} crossings; bounds and cache cleanup.`;
  } finally { await decoder.clearCache(); }
}
