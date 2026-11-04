# Forge recording with actual source waveform peaks (SDK 58)

This is a **draft, source-only follow-up** to [PR #31](https://github.com/mikevocalz/nitro-forge/pull/31), not a replacement for the established Cadence/Splice Rust engines.

## One cross-platform API, honest recording formats

```tsx
import { createRecordingStore } from "@nitro-forge/audio-ui";
import { NativeSourceRecordingTrack } from "@nitro-forge/audio-ui/pcm";

const store = createRecordingStore();
<NativeSourceRecordingTrack
  store={store}
  onSaved={(result) => {
    // Result.kind discriminates actual output:
    // "pcm-wav" (native) or "compressed-web" (browser).
    // result.peaks are min/max audio samples, not a generated sine.
    attachSourceToRust(result);
  }}
/>;
```

### iOS / Android

- Uses the new SDK 58 `expo-audio` **useAudioStream** native PCM API,
  `encoding: 'int16'`, `channels: 1`, and file-backed
  `startFileRecordingAsync({ format: 'wav', directory: 'document' })`.
- Platform native stream writes the actual WAV file. Forge receives real
  interleaved PCM `ArrayBuffer` events to calculate bounded extrema, never
  retaining raw PCM buffers or sending them to React state.
- `WaveformPeakAccumulator` keeps up to 4,096 time-aware segments.
  When compacting, ranges remain frame-aligned and min/max transients
  are preserved. On stop, it emits up to 512 actual-source peak columns.
- The same Zustand recording state machine controls permission, start,
  save, failure, duplicate operations and native lifecycle cleanup.
- **Not a full DAW**: audio sync, latency compensation, source trimming,
  auto gain, multitrack mixing, hardware device selection and Rust
  clip mutation remain unimplemented.

### Web

The SDK 58 `useAudioStream` web implementation is a **stub**, so Forge
**does not pretend it records PCM WAV on web**. The same
`NativeSourceRecordingTrack` name resolves to the real browser
`expo-audio` MediaRecorder used in PR #31, returning a
`{kind:'compressed-web'}` result. After saving, the wrapper attempts
Web Audio `decodeAudioData()` on the returned Blob URL and extracts real
peaks, bounded at 64MiB of encoded source. Browser codec support varies;
on failure it reports `waveform:'unavailable'` and returns the actual
saved URI, never fabricated PCM. Browser waveform processing is
best-effort and not a substitute for native large-file streaming.

### Tests and verification

Pure unit tests cover signed PCM, stereo, float32, nonfinite samples, no
partial frame, 200-chunk extrema compaction and uneven-duration time ranges.
CI inherits audio typecheck, SDK 58 Expo app typecheck, Linux Metro web
export, and Android/iOS native compilation workflows.

**Native hardware mic capture, actual playable WAV, live PCM callbacks,
Web Audio decode success, physical Surface Duo, iPad, headset or pen
interaction: NOT RUN at source commit time.** CI gates must pass before a
merge or release claim. No source-derived CapCraft AGPL code was copied
into this module. The AGPL track is separate.

References:
- https://github.com/expo/expo/blob/main/packages/expo-audio/src/AudioStream.types.ts
- https://github.com/expo/expo/blob/main/packages/expo-audio/src/AudioStream.ts
- https://github.com/expo/expo/blob/main/packages/expo-audio/src/AudioStream.web.ts
- https://github.com/mikevocalz/nitro-forge/issues/28
