# Native OpenXR capture

Optional C++17 library for Meta face tracking v2/social eye tracking and Android
XR face tracking v1/coarse or fine eye tracking. No JavaScript, React Native,
Unity, network transport or CUDA dependency. The host supplies its real OpenXR
instance/session and function resolver; this library does not create a second XR
session or take ownership of the host instance.

## Build

Use Khronos OpenXR headers from commit
`24a1f2b92d212501a2b1b8d30ffd53abf55fcfa8` (the CI pin).

```sh
cmake -S native/persona -B build/persona -DCMAKE_BUILD_TYPE=Debug \
  -DPERSONA_BUILD_OPENXR=ON -DPERSONA_OPENXR_INCLUDE_DIR=/path/to/OpenXR-SDK/include
cmake --build build/persona
ctest --test-dir build/persona --output-on-failure
```

Headers are not vendored or downloaded during configuration. Loader choice stays
with the host. Runtime extension support is separate from header availability.

## Ownership and frame loop

1. Enumerate runtime extensions and enable only supported requested extensions
   when creating the instance. Request the platform's relevant face/eye/audio
   permissions. Supply the exact enabled list in `Context`.
2. Construct a `FaceTracker` and/or `EyeTracker` on the host's XR thread after
   creating its session. Constructors query system capability and resolve actual
   entry points before allocating tracker handles. Errors retain `XrResult`.
3. Poll with the host's predicted display `XrTime`. Pass a live `XrSpace` for eyes.
   Polling writes fixed-size output arrays and clears output on failed, paused,
   invalid or session-loss samples; it does not allocate a JS event each frame.
4. Preserve the returned sample timestamp (Meta/Android face can return an older
   sample). Eye poses are in the supplied reference space. Convert times against
   a host-established session clock anchor before mixing with audio playback.
5. Inspect per-channel validity and regional confidence, then use a calibrated
   vendor-to-rig mapping before feeding the persona selector. These arrays are
   NOT interchangeable with NVIDIA/GNM/ARKit indices. Meta has 70 face channels;
   Android has 68 and different tongue semantics. Android v1 source remains
   `unknown`; it is not asserted to be a measured visual source.
6. Stop polling on permission revocation/session loss. Close trackers before
   destroying the XR session. Destructors attempt cleanup; explicit `close()`
   returns the runtime result. Host must serialize poll/close/destruction.

Meta source selection is explicit: visual or audio, never silent fallback. Its
returned source must match the requested one. Invalid eye-following blendshapes
are masked separately from blinks. Android paused/stopped face output is invalid.
Android eye mode masks left/right individually; closed-eye gaze is invalid while
its separate closed state remains available. No synthetic confidence is assigned
to Android eyes.

## Verification and remaining integration

Strict GCC build against actual Khronos headers and a fake-runtime contract test
pass. The test invokes the real adapter entry-point dispatch with real SDK
structures: capabilities, permissions, source selection, tongue fields, invalid
channels, paused frames, session loss, gaze modes, missing symbols and teardown.
This is NOT a headset capture or performance test.

Not implemented here: platform permission UI, app XR-session integration, PICO
vendor ABI, Android face data-source extension, vendor-to-GNM calibration assets,
clock anchoring, filtering, network transport, Nitro capture controller or splat
GPU binding. No claim of installable full persona support is made.

Primary API definitions: https://github.com/KhronosGroup/OpenXR-SDK/tree/24a1f2b92d212501a2b1b8d30ffd53abf55fcfa8/include/openxr
