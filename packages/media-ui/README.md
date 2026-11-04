# @nitro-forge/media-ui

Cross-platform **Expo SDK 58** playback and waveform building blocks for Nitro Forge.
Universal `@expo/ui` controls render real **SwiftUI** on iOS,
**Jetpack Compose** on Android, and an accessible range control on web.
A bounded waveform view uses React Native views (native iOS/Android; RN Web);
dense timelines belong to the existing **Skia v3** / Board GPU track.

## Source-level components in this batch

- `NativeSeekBar` — controlled, integer-frame native seekbar using a normalized native slider (no huge Compose step count) with optional NTSC
  drop-frame timecode, frame stepping and disabled semantics.
- `NativeLevelSlider` — controlled native gain slider (linear 0..1).
- `WaveformLane` — real min/max peak display with up to 128 column native RN
  bars, optional normalized seek callback. Does **not** simulate microphone data.
- `timebase` — exact rational frame rates and timecode/seconds conversion.
- `waveform` — bounded min/max resampling and plot geometry.

```tsx
import { FRAME_RATES, NativeSeekBar, WaveformLane } from '@nitro-forge/media-ui';

<NativeSeekBar
  frame={currentFrame}
  durationFrames={totalFrames}
  frameRate={FRAME_RATES.NTSC_2997}
  dropFrameTimecode
  onSeek={(frame) => player.seekToFrame(frame)}
/>;

<WaveformLane
  peaks={realRecordedWavPeaks}
  height={68}
  onSeekNormalized={(fraction) => player.seekToFraction(fraction)}
/>;
```

The host owns the actual decoded media, player state and Rust document
session. For actual recorded WAV peak data, consume
`@nitro-forge/native-signal` from its **separate draft PR #24**, which does
not yet implement recording or compression decoding. No duplicate player or
undo journal is created here.

### Platform contract

| Platform | Seek/slider | Waveform | Verification |
|---|---|---|---|
| iOS/iPadOS SDK 58 | SwiftUI via universal `@expo/ui` | RN native views | Source only, device NOT RUN |
| Android phone/tablet/Surface Duo | Jetpack Compose via `@expo/ui` | RN native views | Source only, device NOT RUN |
| Desktop/mobile web | `@expo/ui` web range | React Native Web views | Browser E2E NOT RUN |
| visionOS/PICO | **Not yet claimed** | **Not yet claimed** | Adapter/device QA required |

This is a **first P0 implementation slice**, not 341 completed components.
Follow-on work: native media decoder, scrubbing lifecycle and on-drag-release
events, Skia v3 GPU waveform tiles, live recording, accessible timeline
gestures, object snapping, and fold/hinge rotation + physical-device tests.
A local TS/CI test is not evidence of native function or view execution.

### Native API source reference

- Margelo `api-design`, `build-nitro-modules`, `swift`, `kotlin` skills.
- Expo `expo-ui` and `expo-module` skills.
- Expo 58 universal Slider source:
  https://github.com/expo/expo/tree/main/packages/expo-ui/src/universal/Slider

Do not import CapCraft AGPL code in this package. It is an independent
Forge component. CapCraft-derived controls, if used, stay in the explicit
AGPL module track and require their full combined-work license review.
