# Android-first Forge pen / Muse / ink compatibility contract

Status: **Android is a first-class target by product requirement**.
A real Logitech Muse pen working on an Android device is **NOT yet proven**.
Do not equate working Android ink, BLE discovery, a GATT link, or a similarly
named EEG SDK with Logitech Muse pen compatibility.

## Two unrelated products called Muse

- Logitech Muse **spatial drawing stylus** (marketed for Apple Vision Pro).
  Existing `mikevocalz/viro` PR #2 and `viro-external` PR #49 expose its
  Apple visionOS GameController/ARKit pose + pressure stream.
- Interaxon/ChooseMuse **EEG headband** SDK, including `libmuse_8.0.9`,
  supports Android, iOS and other platforms, but reads EEG, motion/headband
  sensor streams and the .muse format. It is NOT a Logitech stylus protocol.
  The September 27, 2026 approval specifically described headbands and EEG.
  Never load Interaxon's SDK into the Forge drawing/ink pathway.

Reference: https://choosemuse.com/pages/developers
Reference: https://www.logitech.com/en-us/shop/p/muse-for-apple-vision-pro.914-000099

## Android platforms in scope

- Android phones/tablets/foldables, including Surface Duo, with a system-
  supported stylus through Android MotionEvent/React Native Pointer Events.
- Android XR / Galaxy XR, Meta Quest 3/3S and PICO 4 Ultra via their
  **actual** native XR input capabilities, not an assumed Muse Bluetooth
  profile. Capability detection and device-specific testing are mandatory.
- Android 2D ink does **not** require a specific brand of pen. Its native
  pointer path in Board PR #19 is the fastest independently testable gate.
- Vision Pro continues to use the previously merged Viro native Muse SDK,
  but it is not the only desired platform for Forge.

## Stage A — real Android 2D canvas

Reuse PR #19 @nitro-forge/board/skia/native and its existing
NativeBoardCanvasWithInput and createNativeBoardPointerRouter. One host
QuickDraw/Yjs document remains authoritative; do not duplicate edit stores.

- Real Android stylus MotionEvent tool type (stylus vs eraser), hover,
  pressure, button, tilt/orientation and cancellation, when the device
  actually reports them. React Native Pointer Events expose some but not all;
  a reviewed native input adapter may be required for complete axes.
- Normalize to a single board surface transform with palm rejection, real
  pressure (including 0), correct selection/eraser semantics and no duplicate
  stylus+touch strokes.
- No inflated accuracy claims without screenshot, latency, 60/90Hz and
  process-kill/reopen checks.

References:
https://developer.android.com/reference/android/view/MotionEvent
https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/advanced-stylus-features

## Stage B — Android BLE transport (existing Forge PR #20)

The existing @nitro-forge/bluetooth-v1 can request Android permissions,
perform actual foreground scans and a verified GATT link, and properly
close handles. @nitro-forge/pen-connect has a native modal, connection state,
cancellation and Rive-source status frames.

- A GATT-connected callback means `linked` only, not pen-ready.
- Do not hard-code arbitrary Logitech UUIDs, GATT characteristics,
  fake pen coordinates, force/tilt or automatic success after a timeout.
- A specific vendor protocol must be independently documented, licensed
  and observed on hardware before native Android Muse support is claimed.
- The app must verify input from the **same** scanned/permitted device
  (source + device ID + actual pen sample) before moving to `ready`.
- Android scanning must never silently start without explicit user action.

## Stage C — OpenXR tracked stylus adapter for Android XR

- Check at runtime for `XR_LOGITECH_mx_ink_stylus_interaction` and
  `/interaction_profiles/logitech/mx_ink_stylus_logitech`.
- Map real runtime-provided tip/aim/grip poses, force/button, hover,
  cancellation and haptics to a provider-neutral native pen contract.
- In particular, confirm that **a physical Logitech Muse is actually
  registered on the chosen Android XR device**. Supporting the Logitech
  MX Ink OpenXR profile is not proof that Quest/PICO/Galaxy XR can pair,
  track or identify a Muse.
- NVIDIA CloudXR Runtime 6.2.1 maps Muse input into the MX Ink profile;
  their supported Muse CLIENT described in release notes is visionOS.
  Server-side profile support is not evidence of local direct Android
  pairing. CloudXR is an optional upstream reference, not an install or
  universal connectivity promise.

References:
https://logitech.github.io/mxink/
https://github.khronos.org/OpenXR-Inventory/runtime_extension_support.html
https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_runtime/controller_hand_tracking.html
https://docs.nvidia.com/cloudxr-sdk/latest/release_notes/release_notes.html

## User-visible state and Rive verification

State is IDLE -> PERMISSION -> SCANNING -> FOUND -> CONNECTING -> LINKED;
READY is only reachable via verified real native stylus input.
Rive connected-success is forbidden for linked-only status.
Inactive tool icons = original bold outline, selected tools = filled;
respect reduced-motion, screen readers and no second Rive runtime.
See Forge Icons PR #21.

## Acceptance roster — Android has equal priority to visionOS

| ID | Evidence gate | State |
|----|---------------|-------|
| AN-01 | Android 2D stylus pointer down/hover/move/up/cancel, pressure 0..1 with Skia V3 | SOURCE ONLY |
| AN-02 | Device eraser, pen/touch arbitration and tilt when reported by OS | NOT RUN |
| AN-03 | Android Gradle + Nitro v1 + Skia v3 compile and native app launch | NOT RUN |
| AN-04 | BLE permissions dialog, scan, selected device, GATT connected and teardown on real Android | NOT RUN |
| AN-05 | Hardware Logitech Muse visible to Android with an identifiable *documented* protocol | NOT VERIFIED |
| AN-06 | Tracked real Muse tip pose, buttons, force and haptic input on Android | NOT VERIFIED |
| AN-07 | Android XR OpenXR profile/provider capability reported by chosen runtime | NOT RUN |
| AN-08 | Muse strokes saved through single Yjs/MMKV authority, app killed and reopened | NOT RUN |
| AN-09 | Rive animation playback wired to factual linked/ready tool state | NOT RUN |
| AN-10 | Quest, PICO 4 Ultra, Galaxy XR and Surface Duo acceptance runs individually | NOT RUN |

Do not merge as "Logitech Muse for Android ready" until AN-05 and AN-06
succeed. **Android is a required implementation goal, not a proven device
compatibility statement or a reason to substitute an EEG library.**
