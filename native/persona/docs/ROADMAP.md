# Persona pipeline roadmap

Goal: an independent, phone-first persona experience matching the observable
behavior of Apple Vision Pro Persona and Google Galaxy XR Likeness — guided
capture on a companion phone, quality-gated samples, real reconstruction,
explicit review/save, phone-to-headset transfer, and live presence — without
proprietary models, private tracking APIs, or platform-owned assets.

Reference evidence: `research/craft-anything/` (official docs, Play Store
listing/screenshots, signed Likeness APK analysis). The reference pipeline is
RealVatar/GNOME morphable — not Gaussian splats — so our splat renderer is an
independent rendering choice, not a reproduction of their internals.

## Phase status

| # | Stage | Status |
|---|-------|--------|
| 1 | Capture lifecycle state machine | Done — `capture_session.hpp`, CTest 4/4 Release+ASan |
| 2 | Nitro bridge (`PersonaCapture`) | Done — spec + C++ hybrid, Nitrogen 2/2 |
| 3 | Phone capture adapter | Done (typecheck) — VisionCamera v5 outputs, worklet frame processing, zero-copy WebGPU preview |
| 4 | Quality gates | Partial — lighting (luma), face coverage, head yaw/roll, device stability measured; pitch, glasses, phone-to-face pose pending |
| 5 | Transfer transport | Partial — `transfer.ts` upload + manifest done; headset receiver not built |
| 6 | Reconstruction / fitting | **Not started** — needs our own model path |
| 7 | Review/save UI | Done (wired, unreachable until phase 6 calls `generated()`) |
| 8 | Live presence / tracking | Partial — OpenXR adapters + performance core exist; not bound to capture output |
| 9 | Headset apps (Vision Pro / Galaxy XR) | Not started |
| 10 | Device validation | Not run — needs physical phone + headset |

## Remaining work, in dependency order

### A. Landmark/pose evaluator (unblocks pitch + glasses + better head pose)
- Add MediaPipe Face Landmarker (TFLite, Apache-2.0) via `react-native-fast-tflite`
  or a Nitro hybrid, running on the accepted-frame cadence (not per-frame).
- Feeds `head_pose` pitch, `glasses` occlusion heuristic, and tighter coverage.
- Effort: medium. Risk: model asset bundling, runtime perf on-device.

### B. Phone-to-face pose (device_pose upgrade)
- ARCore/ARKit camera pose via `expo-camera` AR or a small native module;
  replaces the accelerometer-stability proxy with real geometry.
- Effort: medium; platform-specific, needs device testing.

### C. Reconstruction backend — the critical path
Options (pick one, evaluate honestly):
1. **Parametric head model fit** (FLAME-style / open morphable model) — closest
   to the reference approach; needs an open model + fitting code (e.g. map
   landmarks → shape/expression params → render mesh). Most faithful, most work.
2. **InstantGaussianAvatar / splat-from-video** — fits our existing rigged
   Gaussian renderer; research candidates already listed in README. Faster to
   prototype, less faithful likeness.
3. **Hybrid**: landmarks → parametric face mesh for identity + splat capture
   for hair/shoulders detail.
- Output must be a real fitted asset consumed by `generated()`; no
  timer-generated or placeholder avatars.
- Effort: large. This is the milestone that makes the experience real.

### D. Phone→headset receiver + processing host
- Headset-side (or companion-app) receiver for `uploadCaptureBundle`,
  decryption-at-rest, calls `generated()`/`transferAcknowledged()` on ack.
- Transport: local network first (mDNS/HTTP on LAN or Nearby Connections /
  Multipeer on platform); cloud sync optional later.
- Effort: medium; needs both apps to exist.

### E. Live presence
- Bind `PersonaPerformance` core + OpenXR face/eye adapters to the saved
  persona; audio-driven viseme path via Audio2X already exists.
- Quest 2/3 and Vision Pro perf budgets per `vr-avatar-engineer` guidance.
- Effort: medium-large; renderer integration required.

### F. Headset UIs
- Vision Pro (visionOS) and Android XR apps: avatar picker, appearance editor
  (warmth/brightness/touch-up/background fill already modeled natively),
  in-call presence. NYC-Tron controls for any RN-hosted chrome.
- Effort: large; platform work.

### G. Validation
- Physical phone capture run, worklet perf profiling, WebGPU preview check,
  headset presence test, recapture/forget data-deletion verification.
- Effort: blocked on hardware.

## What is explicitly out of scope
- Google GNM/RealVatar weights, encrypted encoder modules, AvatarSyncPayload
  protocol — proprietary, not reusable.
- Claiming splats are how Likeness works — they are not.
- WebView/egui persona UI — native controls only.
