# Nitro Forge native personas — first implementation slice

Standalone premium digital-human SDK work. This is not a Moyo package and has
no downstream app dependency. It is distinct from the existing studio's Vector,
Pixel, Layout and Sketch "personas" (editing modes).

## Implemented

- C++17 `Performance`: bounded native-owned timeline, audio-time interpolation,
  explicit missing/gapped coverage, calibration and clamping, atomic rejection,
  reset and idempotent close. Thread-safe methods; not a hard realtime audio callback.
- `Calibration`: explicit source-to-target matrix and per-target range. Asset/model
  calibration data must be supplied. No invented NVIDIA-to-GNM index mapping.
- `Audio2XFrames`: validates and reorders named final blendshape-solver channels,
  converts a supplied rational timestamp to audio seconds, then ingests into the
  native timeline. This adapter does not perform inference.
- `deform`: CPU reference for barycentric mesh-bound Gaussian centers and covariance
  transformed as B*C*B^T. Full covariance is retained under rotation and stretch.
  Requires pre-bound local coordinates, positive-definite covariance and a
  non-degenerate deformed triangle. This is not a GPU rasterizer or GNM evaluator.
- C ABI for non-RN consumers; CMake library and SwiftPM manifest. Native core has
  no React Native, Nitro, JSI, JavaScript, CUDA or UI dependency.
- Actual Nitro v1 decorated class spec, generated Apple/Android bindings and C++
  implementation using the repository's exact nightly-120 pin. Not a v0
  `createHybridObject` wrapper. The `nitro/` package remains private and outside
  workspace release packaging until native app integration is validated.

## Build and use without React Native

```sh
cmake -S native/persona -B build/persona -DCMAKE_BUILD_TYPE=Debug
cmake --build build/persona
ctest --test-dir build/persona --output-on-failure
cmake --install build/persona --prefix /path/to/persona-sdk
```

Include `nitroforge/persona.h` from C/Swift FFI or `nitroforge/persona.hpp` from
C++. Link `nitroforge_persona`. See `tests/c_consumer.c` for a real C-only client.
C ABI pointer arrays must have the documented lengths and remain valid for the
call; the core copies inputs. Output is written only after successful sampling.
Close is idempotent while a handle exists; destroy it once, after callers join.
Do not call a destroyed pointer. Each person/performance gets a distinct session.

C++ renderer hosts sample `Performance` using the exact final audio clip's
playback position, on their animation worker. Do not use wall time or estimate
voice duration. Incoming frames must be strictly increasing; reset for a new clip
or seek/reload. Capacity evicts oldest frames. No coverage is an explicit error,
not a fabricated facial pose. Rendering/host policy decides what to show.

## Nitro v1

The spec and implementation are in `nitro/`. Generate using the pinned nitrogen
and nitro-core versions in that directory's package.json. Generated output is
checked in. Host build integration must include the core sources/headers as well
as `nitro/cpp` and generated platform sources. RN pod/Gradle/autolink packaging,
view attachment and release artifacts are still pending. A generated adapter is
not proof of an installable end-to-end RN package.

The synchronous JS methods are bounded ingest/inspection controls. They are not
an audio inference API and are not the production per-frame renderer loop.
`nativePerformance()` permits a native host to sample directly while retaining
the adapter owner. UI belongs to NYC-Tron; this SDK adds no duplicate controls.

## NVIDIA selection and execution boundary

Selected: **Audio2Face-3D + Audio2Emotion**, together in NVIDIA's Audio2X SDK.
Audio2Emotion conditions Audio2Face; do not add emotions a second time after the
conditioned result. Run on the final generated/performed audio (including any
pitch or speed processing), with one sample clock and model-specific resampling.
NVIDIA's current SDK lists Windows/Linux, CUDA 12.8+ and TensorRT. This does not
establish local inference on Apple Silicon, Vision Pro, Android XR or QNX.

The next SDK executor integration must:
1. Pin model files, SDK commit, source channel schema and GNM calibration revision.
2. Feed the same audio accumulator into emotion and geometry executors.
3. Bind emotion results to the geometry emotion accumulator, preserving their
   different timestamps/rates and CUDA stream ordering.
4. Run the supported blendshape solver and copy finished host coefficients before
   buffers are recycled. Feed final named channels to `Audio2XFrames`.
5. Close/drain both executors, cancel and bound queues, isolate per-person tracks.
6. On CUDA hosts, execute natively; other devices play cached coefficients or
   consume an explicitly configured native transport from a compatible host.
   Do not silently upload capture/audio or claim a verified mobile model conversion.

No CUDA executor, model weights, transport, resampler or TTS provider is bundled
in this first slice. Audio2Face is an animation provider, not a voice generator.

## Reconstruction and rendering milestones

1. Native image/video capture + segmentation + coverage scoring; preserve source
   identity and distinguish observed from inferred regions.
2. GNM fitting and actual model evaluator, neck/shoulder rig, eyes/teeth/tongue;
   calibrated NVIDIA control retargeting. GNM model data is not included here.
3. Fit splats, bind to canonical triangles, optimize appearance and expression
   residuals. Existing renderer discussion selects shared Dawn/WebGPU/WGSL and
   native Viro integration; this slice does not replace it with separate engines.
4. GPU deformation/culling/sorting, LOD/streaming, stereo and compositor lifecycle.
5. Native capture/view/inspector UI through NYC-Tron and Forge adapters, then
   package the SDK independently for C/C++, Swift/Kotlin and Nitro consumers.
6. Real image/video identity benchmark, synchronized speech/emotion benchmark and
   thermal/stereo tests on Vision Pro and Galaxy XR before release claims.

Research candidates: OMG-Avatar (head/shoulders + LOD), FlexiAvatar (partial-body
video), NVIDIA InstantGaussianAvatar (expressive single-image), SqueezeMe
(mobile distillation). GNM integration/retraining is not automatic. Admission of
upstream source, weights and assets requires file-level license review. This
change contains no vendored NVIDIA, GNM, ArtCraft or research implementation.

## Verification on 2026-11-07

Passed on Linux: strict C/C++ builds, native tests and C-only linked consumer;
CMake build and CTest 2/2; AddressSanitizer/UndefinedBehaviorSanitizer with leak
detection disabled because this runner prevents LeakSanitizer process inspection;
Nitrogen generation with 1.0.0-alpha.nightly.120.g33ef045b96c0; generated Apple C++
class/constructor and implementation syntax-check against real Nitro v1 and
React Native 0.88.1 JSI headers (GCC ignores upstream clang lifetime attributes).

Not run: leak check, SwiftPM/Xcode, Android NDK, Windows/QNX, linked Nitro runtime,
CUDA inference, actual GNM fitting, GPU rendering or device tests. CPU reference
math tests are not visual, reconstruction-quality or headset performance evidence.

## Primary references

- https://github.com/NVIDIA/Audio2Face-3D-SDK
- https://github.com/NVIDIA/Audio2Face-3D-SDK/blob/main/audio2face-sdk/source/samples/sample-a2f-a2e-executor/main.cpp
- https://github.com/google/GNM
- https://github.com/storytold/craft-anything
- https://human3daigc.github.io/OMGAvatar_project_page/
- https://yihalem1.github.io/FlexiAvatar/
- https://research.nvidia.com/labs/amri/projects/instant4d/
- https://forresti.github.io/squeezeme/

## Live tracking extension

`openxr/` now provides optional native Meta and Android XR face/eye capture
adapters compiled against real Khronos headers. See [integration and limitations](openxr/README.md).
`tracking.hpp` selects calibrated recent live controls ahead of audio controls;
invalid/stale channels fall back to audio or neutral. The provider outputs must
be calibrated and clock-aligned by the host before selection. Device capture,
PICO, GNM retargeting assets and renderer binding are not yet verified.

## Capture experience

`capture_session.hpp` implements guided capture lifecycle with host quality
acceptance, accessible optional-step skipping, explicit generated-asset review,
retry, cancellation and protection against stale asynchronous results. It keeps
the previous saved avatar until a new reviewed candidate is accepted. Capture
source is explicit: local device, companion phone or supplied media. A
companion-phone session seals its samples into a `handoff` stage and requires
`transferAcknowledged()` before processing, mirroring the observed reference
app's explicit phone-to-headset acknowledgement without implying account sync.
Camera capture, UI, fitting and persistence stay with explicit host adapters.
See [Craft Anything study and execution limitations](research/craft-anything/STUDY.md).
