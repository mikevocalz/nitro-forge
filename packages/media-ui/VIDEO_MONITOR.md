# SDK 58 native decoded video monitor

`@nitro-forge/media-ui/video` is an optional real playback adapter for
`@nitro-forge/media-ui`, implemented via Expo Video (AVPlayer / Media3 /
browser video). This subpath avoids forcing media codec dependencies on
consumers that only need a transport slider or waveform geometry.

```tsx
import { NativeVideoMonitor, createVideoMonitorStore }
  from "@nitro-forge/media-ui/video";

const store = createVideoMonitorStore();

function Preview() {
  return (
    <NativeVideoMonitor
      source={pickedVideoUri}
      store={store}
      frameRate={{ numerator: 30000, denominator: 1001 }}
    />
  );
}
```

**Actual capabilities:** native decoded video surface, play/pause, seek request
mapped to rational frames in the caller's timebase, real duration/status/time events, clamped frame
steps, progress/buffer telemetry, and lifecycle disposal through Expo's
`useVideoPlayer`. Uses the existing `NativeSeekBar` from PR #25.

**Precision:** requesting a frame is not evidence that the decoder shows it.
The monitor keeps `requestedFrame` separate from `reportedFrame`. A request
clears when a native `timeUpdate` reaches the requested frame (while playing,
up to one event interval past it). Reports from before the seek never clear
it. Expo Video has no seek-completed event and a paused player may emit no
`timeUpdate`, so 400 ms after the last seek the monitor reads
`player.currentTime` and records that native position as the reported frame.

Seeks target the centre of the frame interval, `(2n + 1) * den / (2 * num)`,
and reported times map back with `floor`, so a float shortfall cannot land on
frame `n - 1`.

`seekTolerance` is set to zero. AVPlayer (iOS) and Media3 (Android) honour it;
the web backend ignores `seekTolerance`, so web seeks are whatever the browser
`HTMLVideoElement` does and are not exact. Codecs, GOP structure and remote
streams can still make native seeks approximate.

Frame indices use the `frameRate` prop, not the media track. The monitor shows
the track's own rate from `VideoTrack.frameRate` when iOS or Android reports
it; web always reports it as unavailable. No frame-exact output or
compositing claim.

**Cross-platform contract:** Expo Video's supported backend is iOS AVPlayer,
Android Media3, Web video; the control API is shared. The SDK 58 sample
demonstrates an online upstream Expo documentation fixture. Actual iOS,
Android, Surface Duo and web browser playback tests are **NOT RUN**.
PICO and visionOS are not claimed. The Rust Splice engine is still the editing
authority (clips/undo/render plan); this is a media preview, not a substitute
for a source/audio decoder or export encoder.

No copied CapCraft or Adobe UI source. No new WebView editor, local React
`useState`, or duplicated document store.
