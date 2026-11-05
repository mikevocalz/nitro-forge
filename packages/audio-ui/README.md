# @nitro-forge/audio-ui

Forge audio uses **react-native-audio-api 1.0.0**, verified against live npm
registry metadata and the published package source on November 4, 2026.
There is no Expo Audio runtime, import, dependency or config plugin here.
Expo SDK 58 remains the app/build system, not the audio engine.

The view is NYC-Tron UI's `RecordingTrack`
(`@nyc-tron/ui/components/forge/audio/RecordingTrack`, pinned in
`tooling/nyc-tron.json`). Forge keeps the recorder: `NativeRecordingTrack` and
`NativeSourceRecordingTrack` map the controller's phase onto the view with
`toRecordingViewState` and feed the newest measured peak to its `LevelMeter`.
The host app must compile NYC-Tron's class names with Uniwind; see
`apps/forge-audio-lab/global.css` for the tokens.

## Actual implementation

- Native iOS/Android: `AudioRecorder` writes mono 48 kHz 16-bit WAV into the
  document directory. Real planar PCM callback extrema feed bounded waveform
  storage. File I/O/encoding stays native; JS receives 100 ms preview chunks.
- Web: Audio API has **no AudioRecorder export**. Browser `getUserMedia` and
  `MediaRecorder` capture compressed audio; Audio API decodes it for peaks and
  playback. Requires HTTPS and browser permission. No pretend WAV fallback.
- Shared `NativeAudioPreview`, drawn with NYC-Tron's `AudioPreview`: Audio API
  `AudioContext.decodeAudioData`, fresh
  one-shot `AudioBufferSourceNode`, native graph scheduling, stop/ended cleanup
  and stale-decode rejection. Audition is limited to recordings <=60 seconds
  and <=32 MiB decoded PCM, not unbounded DAW streaming. The playhead reads
  the graph clock every 100 ms.
- NYC-Tron views over Forge controllers and a Zustand lifecycle. No duplicate
  Rust document or undo journal, no simulated audio, no JS audio render loop.

```tsx
import { createRecordingStore } from "@nitro-forge/audio-ui/recording";
import { NativeSourceRecordingTrack } from "@nitro-forge/audio-ui/pcm";
import { NativeAudioPreview } from "@nitro-forge/audio-ui/playback";
const store = createRecordingStore();
// Mount one recording owner for this store.
<NativeSourceRecordingTrack store={store} onSaved={file => console.log(file.uri)} />;
// Supply a finalized local file or live browser Blob URI and its real duration.
<NativeAudioPreview uri={savedUri} durationSeconds={savedDuration} />;
```

A URI is a capture result, **not a committed Rust Cadence clip**. Cadence's
current `addClip` schema has no source URI field. Hosts must not claim a
recording was attached to the project until a real engine operation supports
and acknowledges it. Rust remains authoritative for project/undo/transport.

## Lifecycle and platform limits

Permission is requested only by the user's Record action. Background audio
and Android foreground services are explicitly disabled. A take is never
dropped without the user saving it; the `interrupted` phase carries a
`cause`:

- `session`: an OS interruption began (call, Siri, another app taking audio
  focus). The recorder is paused with the WAV still open. When the OS ends
  the interruption with `shouldResume`, capture resumes into the same file
  and the timer continues once `isRecording()` confirms capture restarted
  (Audio API's `resume()` returns quietly when it cannot resume). If it ends
  without `shouldResume`, capture is paused (iOS restarts input on its own)
  and the partial WAV is finalized; the phase moves to `ended`. After a
  resume the inputs are compared again, so a headset unplugged during the
  interruption pauses the take as `input-lost`.
- `input-lost`: a `routeChange` with `OldDeviceUnavailable` removed an input
  that was present when the take started (a headset mic unplugged; Android
  reports this from its `AudioDeviceCallback`). The recorder pauses so
  nothing is captured from a different microphone. Removing an output-only
  device does not pause. If the device list cannot be read, the take pauses.
- `ended`: the app going to the background, or the input stream stopping on
  its own, finalizes the WAV and releases the microphone. iOS `inactive`
  (a call banner, Siri, Control Center) does not end the take. The stream
  counts as stopped after 2 status polls (500 ms), or 8 polls (2 s) while
  the recorder reads as paused, because iOS marks the engine interrupted
  before it delivers the interruption event.

Interruption, route and lifecycle events run one at a time in arrival
order. A failed native pause or resume finalizes the take into `ended`
with the reason in the message, so it stays saveable. In every case "Save
what was recorded" returns the file. Recorder errors and unreadable
callback buffers abort with a visible error.

After each attempt, once the recorder has stopped, interruption observation
is turned off and the session is released. With no Forge preview playing,
the session is deactivated; `notifyOthersOnDeactivation` (set in the capture
options) lets other apps resume their audio. While a preview plays, the
session stays active and returns to the `playback` category, because
deactivating would cut the preview off; it is deactivated when the preview
ends, unless a new take has configured the session again.

NYC-Tron platform playback sessions own preview intent and system
interruption/output-loss handling. A preview stops on system loss and needs
a new Play press. The session registry observes those session stores, so
the last preview releases focus only when no recorder or other preview owns it.
Browser capture releases tracks
on stop/error/unmount and caps encoded output at 64 MiB. Browser Blob URLs
are owned by the recording component and expire on new capture/unmount;
consumers must persist bytes before relying on them for a project.

Native hosts need a development build, the Audio API plugin and microphone
usage declaration (see audio-lab app.json). Expo Go cannot run the native
module. FFmpeg and worklets are not enabled or needed for this slice.

Android-based Meta/Quest can use the same component only after its native
build, mic permission, audio routing and spatial-host integration pass. No
Meta/PICO/visionOS runtime support is claimed merely from shared TypeScript.
No Skia v3, Nitro v1 or concurrent Studio PR #5 files are changed.

## Verification

`node --experimental-strip-types --test packages/audio-ui/node-tests/audio-api.test.mjs`
passes seven contracts: file URI normalization, planar peaks, source cleanup,
late decode cancellation, and bounded/invalid playback rejection. The Vitest
suite (`tests/`) covers the recording state machine, the PCM capture window
for interleaved and planar buffers, web decode bounds and the `./pcm` export
conditions; it does not import Audio API, but CI runs it after the frozen
install, so it is gated with everything else below.

The 24-hour minimum-release-age policy blocks Audio API 1.0.0 until
**2026-11-04 18:01:08.810 UTC**. The attempted lock resolution reported
`ERR_PNPM_NO_MATURE_MATCHING_VERSION`; no age exception was added. Frozen
lockfile regeneration, full TypeScript, existing Vitest lifecycle tests,
Metro web export and iOS/Android compilation remain pending after that gate.
Real mic capture/playback/interruptions, browser interaction, device memory,
foldable accessibility and Meta hardware are **NOT RUN**.

## API and engineering roster

| Responsibility | Concrete surface | Verification |
| --- | --- | --- |
| Native capture | AudioRecorder, FilePreset, AudioManager | Published 1.0.0 source; runtime pending |
| Browser capture | getUserMedia, MediaRecorder, Blob URL | Source review; browser E2E pending |
| Playback graph | AudioContext, AudioBufferSourceNode | Injected lifecycle contracts; device pending |
| Waveform | planarPeak, WaveformPeakAccumulator | Pure tests; device callback continuity pending |
| Project ownership | Rust Cadence addClip/render schema unchanged | ENGINE_OPS inspected; no attachment claim |
| UI | NYC-Tron RecordingTrack / AudioPreview (v0.1.0-alpha.3) | Typecheck, Metro web render; device pending |
| Dependency safety | npm latest + minimumReleaseAge 1440 | Real registry and rejected install |

Reviewed repository AGENTS.md, ARCHITECTURE.md, ENGINE_OPS.md and ROSTER.md;
Margelo pinned `api-design` and `build-nitro-modules` skills for explicit
ownership, API freshness, typed contracts, failure and cleanup. This change
uses upstream native code; it does not generate new Swift/Kotlin/Nitro code.

Sources:
- https://registry.npmjs.org/react-native-audio-api (latest 1.0.0; published 2026-11-03T18:01:08.810Z)
- https://docs.swmansion.com/react-native-audio-api/docs/fundamentals/getting-started/
- https://docs.swmansion.com/react-native-audio-api/docs/inputs/audio-recorder/
- https://github.com/software-mansion/react-native-audio-api
- https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md
- https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/build-nitro-modules/SKILL.md
