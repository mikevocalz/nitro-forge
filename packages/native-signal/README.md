# @nitro-forge/native-signal

**Draft Expo SDK 58 / Expo Modules 2.0 native service.** This is the first small, testable slice of the ArtCraft Android source-audit work in [docs/ARTCRAFT_ANDROID_EXPO58_COMPONENT_MAP.md](../../docs/ARTCRAFT_ANDROID_EXPO58_COMPONENT_MAP.md).

This package is an **original implementation**. No ArtCraft code/assets have been copied.

## API

```ts
import { analyzeWavFile } from '@nitro-forge/native-signal';

// file:// URI to a mono/stereo 16-bit uncompressed PCM RIFF/WAVE file
const waveform = await analyzeWavFile(fileUri, 768);
// [{ min: -0.4, max: 0.6 }, ...], exactly 768 columns
```

- Expo Modules 2.0 annotated native method `ForgeSignal.analyzeWavFile` implemented in **Swift and Kotlin**.
- WAV must be local `file://` and <=64 MiB; channels 1 or 2; 16-bit little-endian PCM; 8kHz..384kHz.
- Each column uses real min/max samples from its time range, including all input channels. Empty columns become zero. Returned values are normalized to [-1, 1].
- Analysis is dispatched off the main thread. It is not a live audio tap, recorder, decoder, player or visual waveform view.
- Integration requires an Expo SDK **58** native development build; Expo Go and a web fallback are **not** validated.

## Known pending gates

- Swift/Xcode 27 and Gradle/AGP native builds, v2 module auto-link, JavaScript device invocation, fixture-based Swift/Kotlin parity.
- Streaming/tiling for longer audio files and compressed sources via the host decoder.
- Cancellation, lifecycle, disk-backed analysis cache keyed by audio content hash and sample range.
- Native waveform canvas and multitrack waveform UI, which belong to `@nitro-forge/audio-ui` and use peak data from this module.
- Expo Modules 2.0 native-view API is not claimed; for true custom views use supported `@expo/ui` or Expo View DSL behind adapters until `@ExpoView` is available and tested.

## Authorship and boundaries

Do not add app-specific Moyo code, credentials, assets, isolated persistence or a second undo store. Cadence/Splice remain document authorities. License: MIT for this newly written package; upstream references retain their own licensing requirements.
