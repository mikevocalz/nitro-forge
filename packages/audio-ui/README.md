# @nitro-forge/audio-ui

**P0 native microphone recording and live level history** for Nitro Forge.
Uses the verified **Expo SDK 58** `expo-audio` API (AVAudioRecorder on iOS,
MediaRecorder on Android and browser MediaRecorder on web). The view is
NYC-Tron UI's `RecordingTrack` (`@nyc-tron/ui/components/forge/audio/RecordingTrack`,
pinned in `tooling/nyc-tron.json`). Forge keeps the recorder: `NativeRecordingTrack`
maps the controller's phase onto the view with `toRecordingViewState` and feeds
the newest meter peak to its `LevelMeter`. The host app must compile NYC-Tron's
class names with Uniwind; see `apps/forge-audio-lab/global.css` for the tokens.

The parent `@nitro-forge/media-ui` package supplies the initial bounded
`WaveformLane`; the native `@nitro-forge/native-signal` package in #24
provides **16-bit PCM WAV peak extraction only**.

## Usage

```tsx
import { createRecordingStore, NativeRecordingTrack } from "@nitro-forge/audio-ui";

const store = createRecordingStore();
function MyAudioTrack() {
  return <NativeRecordingTrack
    store={store}
    onSaved={(uri) => {
      // Add actual saved .m4a / WebM URI to the Cadence or Splice source track.
      // Do not claim a document mutation until Rust acknowledges it.
      console.log("Recorded URI:", uri);
    }}
  />;
}
```

The state machine is **Zustand-only** (no Forge useState), uses one native
recording session and permission prompt on user activation. Tracks explicit
lifecycle phases, prevents concurrent start/stop, displays actual native
metering dB converted to normalized amplitude, and returns the real saved
media URI only after a successful native stop.

**Crucial signal distinction:** the live chart is **microphone level history**
sampled every 100 ms, not decoded PCM waveform peaks. Do not use these bars
as source-frame waveform data for cutting/export. Actual editor audio files
use compressed AAC in .m4a on iOS/Android and typically WebM on the web.
The separate WAV-only `native-signal` analyzer **cannot read those files**.
A media decoding/envelope pipeline using AVFoundation and Android
MediaExtractor/MediaCodec or native Rust decoder is needed in the follow-on
Skia v3 waveforms track #28. Never silently substitute synthetic peaks.

## Native platform and safety

- iOS/iPadOS: audio permission via `requestRecordingPermissionsAsync()`,
  native iOS recording, save to the app document directory.
- Android phones/tablets/Surface Duo: system mic permission, Android native
  `MediaRecorder`, document directory, fold-safe adaptive host UI.
- Web: `MediaRecorder` with browser-specific MIME. Requires secure context
  and permission; returned URLs may be ephemeral Blob/object URLs.
- Recording does **not** automatically continue in the background; do not
  enable a background audio service without a separate consent/config flow.
- The Expo `expo-audio` native module owns its resource lifecycle; the Forge
  controller calls `stop()` on unmount and prevents stale session reuse.
- Host app must configure the `expo-audio` plugin/Info.plist microphone usage
  description and use a **development build** for real native testing.
- No direct upstream ArtCraft or CapCraft code is copied in this package.
  AGPL-derived components remain separate and opt-in.

## Verification

The repository's CI tests state transitions, rejection, actual-URI gating,
bounded metering math, and a SDK 58 Expo showcase app typecheck plus Metro web
export. Actual hardware mic permissions, live file output, interruptions and
record/save across iOS/Android/Web are **NOT RUN** until integration tests and
device evidence exist. This is an implementation slice, not full DAW parity.

### Applied native API skills
Pinned Margelo `api-design`, `build-nitro-modules`, `swift`, `kotlin`,
Expo `expo-ui` and `expo-module`, plus Forge `AGENTS.md`. 
The heavy audio I/O is delegated to Expo's built-in native audio module,
not reimplemented as an unsafe custom JSI bridge.

Current Expo 58 references:
- https://docs.expo.dev/versions/v58.0.0/sdk/audio/
- https://github.com/expo/expo/blob/main/packages/expo-audio/src/AudioModule.types.ts
