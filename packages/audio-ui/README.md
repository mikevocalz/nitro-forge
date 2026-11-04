# @nitro-forge/audio-ui

Forge audio uses **react-native-audio-api 1.0.0**, verified against live npm
registry metadata and the published package source on November 4, 2026.
There is no Expo Audio runtime, import, dependency or config plugin here.
Expo SDK 58 remains the app/build system, not the audio engine.

## Actual implementation

- Native iOS/Android: `AudioRecorder` writes mono 48 kHz 16-bit WAV into the
  document directory. Real planar PCM callback extrema feed bounded waveform
  storage. File I/O/encoding stays native; JS receives 100 ms preview chunks.
- Web: Audio API has **no AudioRecorder export**. Browser `getUserMedia` and
  `MediaRecorder` capture compressed audio; Audio API decodes it for peaks and
  playback. Requires HTTPS and browser permission. No pretend WAV fallback.
- Shared `NativeAudioPreview`: Audio API `AudioContext.decodeAudioData`, fresh
  one-shot `AudioBufferSourceNode`, native graph scheduling, stop/ended cleanup
  and stale-decode rejection. Audition is limited to recordings <=60 seconds
  and <=32 MiB decoded PCM, not unbounded DAW streaming.
- Shared React Native / `@expo/ui` controls and Zustand lifecycle. No duplicate
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
and Android foreground services are explicitly disabled. Native recorder
errors, interruption and leaving foreground stop capture, with a visible
error and no automatic microphone restart. Browser capture releases tracks
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
late decode cancellation, and bounded/invalid playback rejection.

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
| UI | shared RN/@expo/ui controls | Typecheck/Metro/device pending |
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
