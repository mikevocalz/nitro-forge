/** File paths from native recording must not be mistaken for bundled Android assets. */
export function recordingFileUri(paths: readonly string[]): string {
  if (paths.length !== 1) throw new Error("Expected one finalized recording file");
  const path = paths[0]!;
  if (path.startsWith("file://")) return path;
  if (!path.startsWith("/")) throw new Error("Recorder returned an invalid local path");
  return "file://" + encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/** Reduce planar PCM, not an invented symmetric microphone level. */
export function planarPeak(channels: readonly Float32Array[], frames: number) {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > 65536 ||
      channels.length < 1 || channels.length > 8 || channels.some(c => c.length < frames)) {
    throw new RangeError("Invalid audio callback dimensions");
  }
  let min = 1, max = -1;
  for (const channel of channels) {
    for (let i = 0; i < frames; i++) {
      const sample = channel[i]!;
      if (!Number.isFinite(sample)) throw new RangeError("Invalid PCM sample");
      min = Math.min(min, sample); max = Math.max(max, sample);
    }
  }
  return { min: Math.max(-1, min), max: Math.min(1, max) };
}

/** Capture shutdown must wait for an in-flight native start, including a rejected start. */
export async function stopAfterStart<T>(starting: Promise<unknown> | null, stop: () => Promise<T>): Promise<T> {
  await starting?.catch(() => undefined);
  return stop();
}
