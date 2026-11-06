/**
 * Memory bounds for decoding a browser recording with decodeAudioData().
 * Decoding expands to float32 per channel at the AudioContext rate, so a
 * small compressed clip can need GiBs. Pure functions, unit tested.
 */

/** Encoded clip cap when the container reports a usable duration. */
export const MAX_ENCODED_BYTES = 64 * 1024 * 1024;
/**
 * Encoded cap when the duration is unknown (Chrome's MediaRecorder WebM
 * reports Infinity until fully parsed). At 32 kbit/s or more, 8 MiB is at
 * most ~35 minutes, about 400 MiB decoded as 48 kHz stereo. Lower bitrates
 * are still caught by postDecodeRejection().
 */
export const UNKNOWN_DURATION_MAX_ENCODED_BYTES = 8 * 1024 * 1024;
/** Decoded PCM cap: about 46 minutes of 48 kHz stereo float32. */
export const MAX_DECODED_BYTES = 512 * 1024 * 1024;

const MiB = 1024 * 1024;

export function decodedByteEstimate(
  durationSeconds: number, sampleRate: number, channels: number,
): number {
  if (![durationSeconds, sampleRate, channels].every(Number.isFinite) ||
      durationSeconds < 0 || sampleRate <= 0 || channels < 1) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil(durationSeconds * sampleRate) * channels * 4;
}

function tooLarge(bytes: number): string {
  return `Decoded recording would need ${Math.ceil(bytes / MiB)} MiB; ` +
    `the waveform decode limit is ${MAX_DECODED_BYTES / MiB} MiB.`;
}

/**
 * Reason to skip decoding, or undefined to proceed. Channel count is not
 * known before decoding, so stereo is assumed.
 */
export function preDecodeRejection(
  encodedBytes: number, probedDurationSeconds: number, contextSampleRate: number,
): string | undefined {
  if (encodedBytes <= 0 || encodedBytes > MAX_ENCODED_BYTES) {
    return `Encoded recording size ${encodedBytes} B is outside 1..${MAX_ENCODED_BYTES} B`;
  }
  const estimate = decodedByteEstimate(probedDurationSeconds, contextSampleRate, 2);
  if (Number.isFinite(estimate)) {
    return estimate > MAX_DECODED_BYTES ? tooLarge(estimate) : undefined;
  }
  return encodedBytes > UNKNOWN_DURATION_MAX_ENCODED_BYTES
    ? `Recording duration is unknown and the encoded clip exceeds ` +
      `${UNKNOWN_DURATION_MAX_ENCODED_BYTES / MiB} MiB, so decoded size cannot be bounded`
    : undefined;
}

/** Checked on the AudioBuffer itself; the caller drops the buffer on rejection. */
export function postDecodeRejection(frames: number, channels: number): string | undefined {
  const bytes = frames * channels * 4;
  return bytes > MAX_DECODED_BYTES ? tooLarge(bytes) : undefined;
}
