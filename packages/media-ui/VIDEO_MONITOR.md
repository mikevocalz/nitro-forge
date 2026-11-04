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
mapped to rational frames, real duration/status/time events, clamped frame
steps, progress/buffer telemetry, and lifecycle disposal through Expo's
`useVideoPlayer`. Uses the existing `NativeSeekBar` from PR #25.

**Precision:** requesting a given frame is NOT evidence that the corresponding
decoded frame is displayed. The monitor tracks `requestedFrame` separately
from `reportedFrame`, clearing the request only on a `timeUpdate` event.
The player asks for exact seek tolerance but codecs, GOP structure, remote
streams and platform implementations may still be approximate. No false
frame-exact output or compositing claim.

**Cross-platform contract:** Expo Video's supported backend is iOS AVPlayer,
Android Media3, Web video; the control API is shared. The SDK 58 sample
demonstrates an online upstream Expo documentation fixture. Actual iOS,
Android, Surface Duo and web browser playback tests are **NOT RUN**.
PICO and visionOS are not claimed. The Rust Splice engine is still the editing
authority (clips/undo/render plan); this is a media preview, not a substitute
for a source/audio decoder or export encoder.

No copied CapCraft or Adobe UI source. No new WebView editor, local React
`useState`, or duplicated document store.
