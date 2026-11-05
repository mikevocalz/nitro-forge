# @nitro-forge/media-ui

Cross-platform **Expo SDK 58** playback and waveform building blocks for Nitro Forge.
Universal `@expo/ui` controls render real **SwiftUI** on iOS,
**Jetpack Compose** on Android, and an accessible range control on web.
A bounded waveform view uses React Native views (native iOS/Android; RN Web);
dense timelines belong to the existing **Skia v3** / Board GPU track.

## Where the components live

`NativeSeekBar`, `WaveformLane`, the timebase math and the waveform math are
owned by [NYC-Tron UI](https://github.com/mikevocalz/NYC-Tron-UI). Forge
depends on the release tarball pinned in `tooling/nyc-tron.json`
(v0.1.0-alpha.1); `node tooling/verify-nyc-tron-pin.mjs --download` checks the
specifiers, the lockfile and the SHA256SUMS digest. NYC-Tron never imports
Forge.

New code imports the NYC-Tron subpaths directly:

```tsx
import { NativeSeekBar } from '@nyc-tron/ui/components/forge/NativeSeekBar';
import { WaveformLane } from '@nyc-tron/ui/components/forge/WaveformLane';
import { FRAME_RATES } from '@nyc-tron/ui/components/forge/timebase';

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
  position={playheadFraction}
  onSeekNormalized={(fraction) => player.seekToFraction(fraction)}
/>;
```

`@nitro-forge/media-ui` re-exports those names so existing call sites keep
working. NYC-Tron styles them with Tailwind v4 classes (`bg-accent`,
`bg-surface-sunken`, `bg-surface-raised`, `rounded-control`), so the host app
needs Uniwind and the tokens from NYC-Tron's `docs/THEME_TOKENS.md`;
`apps/forge-media-lab` (`metro.config.js`, `global.css`) shows the setup. The
old `foregroundColor`/`backgroundColor` props are gone; set `--color-accent`
and `--color-surface-sunken`, or pass `barClassName`/`className`.

Still local until NYC-Tron v0.1.0-alpha.2:

- `NativeLevelSlider`, replaced by NYC-Tron `LevelFader` (NYC-Tron-UI PR #20).
- `framesToSeconds` / `secondsToFrame` in `src/timebase.ts` (NYC-Tron-UI PR #20).

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
