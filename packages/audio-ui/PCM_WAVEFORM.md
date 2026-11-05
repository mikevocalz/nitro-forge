# Source waveform capture

The native recorder is **react-native-audio-api 1.0.0 AudioRecorder**.
`enableFileOutput` configures 48 kHz mono 16-bit PCM WAV in the document
directory; `onAudioReady` supplies actual planar Float32 samples for bounded
min/max accumulation. `stop()` must succeed with one finalized file path
before `onSaved` receives a `pcm-wav` result. Empty peak coverage is returned
as empty columns, never generated waveform data.

On web, direct browser MediaRecorder captures compressed bytes. Audio API's
browser decoder extracts source peaks when its codec supports the recording.
There is no browser AudioRecorder implementation upstream; this distinction
is explicit in `SourceRecordingFile`. Decode failure returns the real URI
with `waveform: 'unavailable'` and a `reason`, not fabricated PCM.

```tsx
import { createRecordingStore } from "@nitro-forge/audio-ui";
import { NativeSourceRecordingTrack } from "@nitro-forge/audio-ui/pcm";

const store = createRecordingStore();
<NativeSourceRecordingTrack
  store={store}
  onSaved={(result) => {
    // result.kind is "pcm-wav" (native) or "compressed-web" (browser).
    // result.peaks are min/max audio samples, not a generated sine.
    attachSourceToRust(result);
  }}
/>;
```

### iOS / Android

- `WaveformPeakAccumulator` keeps up to 4,096 time-aware segments. When
  compacting, ranges stay frame-aligned and min/max transients are kept.
- `PcmCaptureSession` counts peaks only while the WAV is being written: the
  window opens with `recorder.start()` and closes once `recorder.stop()` has
  finalized the file. Elapsed time is callback frames / callback sample rate.
  On save, the timeline is padded to the finalized file duration, so 512
  columns line up with the WAV even if the last callback chunk never arrived.
  Those columns are written to the store, and the lane shows the whole
  recording after saving (drawn at `WaveformLane`'s 128-column maximum).
- A malformed callback buffer advances the timeline by `numFrames` (an empty
  gap, counted in `droppedBuffers`); a buffer whose frame count is not a
  positive integer aborts the recording with an error.
- An `interruption` that begins pauses the recorder with the WAV open; the
  capture window stays open, so the peaks stay aligned with the file. On
  `ended` with `shouldResume` the same file resumes. Without it, or on
  leaving the foreground, or when `isRecording()` turns false, the partial
  WAV is finalized. A `routeChange` that removed an input pauses the take.
  "Save what was recorded" returns the file in every case. See the README's
  lifecycle section for the causes.
- After every attempt the recorder stops first, then the session is
  released: deactivated with `notifyOthersOnDeactivation` when no preview
  plays, or returned to `playback` while one does.
- Each effect run owns a fresh recorder and controller, so StrictMode and
  Fast Refresh re-runs never reuse a disposed owner.
- **Not a full DAW**: audio sync, latency compensation, source trimming,
  auto gain, multitrack mixing, hardware device selection and Rust clip
  mutation remain unimplemented.

### Web

After saving, the wrapper decodes the Blob URL and extracts real peaks.
Decoding expands to float32 per channel, so memory is bounded on decoded
size (512 MiB, about 46 minutes of 48 kHz stereo): the clip's duration is
probed from an `<audio>` element first; when the container reports no
duration (Chrome WebM), only clips up to 8 MiB encoded are decoded; the
decoded buffer is checked again and dropped if over the cap. Encoded input
stays capped at 64 MiB. A decode that finishes after a newer recording,
store swap or unmount is discarded. A hidden tab ends capture and moves to
`interrupted`; the clip is saved by the user, not dropped.

### Resolution of `@nitro-forge/audio-ui/pcm`

| Condition | File |
| --- | --- |
| `react-native` (Metro iOS/Android) | `NativeSourceRecordingTrack.native.tsx` |
| `browser` (Metro web, web bundlers) | `NativeSourceRecordingTrack.web.tsx` |
| anything else | `NativeSourceRecordingTrack.unsupported.ts`, throws at import |

### Verification

The live callback visualization is a recording preview. Hardware callback
continuity, exact full-file peak parity and long-duration streaming remain
acceptance checks; this is not a sample-accurate DAW timeline claim. See
[README](README.md) for architecture, platform limits, the dependency age
gate, API sources, tests and unverified device work.
