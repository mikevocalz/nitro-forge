# Persona experience study — Craft Anything

## Actual tool execution

Two Craft Anything runs were executed independently; the tool was not copied
into the premium component.

1. Craft Anything 0.5.0 Linux CLI, downloaded from the official release and
   verified against its SHA256SUMS.txt (archive SHA256
   `d18c54ef05e5c7ef50f8c4959fee8983c0a4a1f141edc488d11f7029973c885b`,
   https://github.com/storytold/craft-anything/releases/tag/v0.5.0).
   `core_brief_write`, `web_site_open`, `web_site_capture` and
   `core_report_write` ran in clean-room mode, but browser launch failed with
   `socket() failed: Operation not permitted`; capture returned
   `no website is open` and the report correctly recorded zero evidence.
2. Craft Anything 0.3.0 macOS universal CLI (the checksum-verified binary
   already vendored under `artifacts/craft-anything/tool/`), driven through its
   own MCP server (`craft-anything-cli mcp --clean-room`) so `web_site_open`
   and `web_site_capture` share one private browser session. The same
   brief → open → capture → report sequence succeeded on this host:
   `web_site_open` launched the bundled Chromium over CDP and
   `web_site_capture` wrote full-page PNGs at 390/768/1440 CSS px plus
   `capture.json` (visible text, headings, outline, design tokens) for both
   reference pages. Local artifacts (gitignored):
   `artifacts/craft-anything/persona-study/capture-apple`,
   `artifacts/craft-anything/persona-study/capture-google`, and
   `artifacts/craft-anything/persona-study/REPORT.md`.

Evidence ids: Apple open `ev_53a8ed112e1178a1345aaabe5c7fffe1270301f7a8058b5b0969e4362a6af87f`,
Apple capture `ev_bc8453045b34f23c217777f5adec65bf288cfee4135e9d82e58467de67663dd4`,
Google open `ev_21a209d0c56a6fe379b4942a6cdf2b2ab40610941835bfae2ec93f1c3dae7a21`,
Google capture `ev_9b8c5720b51f56b432dac0eeaccabf81980669d3fd5e80503f6d7c4f2d13b888`.

3. Craft Anything 0.5.0 macOS universal CLI (official release, SHA256 verified
   against SHA256SUMS.txt), run in deep mode over the same MCP transport with
   the browser toolset enabled. Targets were the phone side of the experience:
   the Likeness (beta) Play Store listing
   (`com.google.android.apps.vr.doppel`, captured at 390 px with page source)
   and the compatible-devices help page. Deep mode also retained `page.html`,
   from which the eight published app screenshots were downloaded at native
   resolution (four portrait phone captures, four landscape headset views) and
   text-extracted locally with macOS Vision OCR; OCR output is kept next to
   the images under
   `artifacts/craft-anything/persona-study/capture-playstore-phone/app-screenshots/`.
   Evidence ids: Play Store open `ev_1787990f0000002d07c257fbf27be9da2d35b8a86b99948e3876822722773afc`,
   capture `ev_9ab156c8b52274c2770afa67f3a63236df2f8f5f03471e0cde1df8040043808f`;
   devices page open `ev_a51ef7b80388bc1c29f30cf9579e04ee7a78ef5cd6488f0f003fe655b4aa6c83`,
   capture `ev_2e0b204f461dd8681b3aa072f10e0aab11a4e1128c87ab5b0a40ad6999701f94`.

The captured material is the rendered public documentation, not the in-headset
capture UI itself: these pages describe the flows in text and imagery but the
actual guided-capture screens live on the devices. No pixel or spatial
similarity score was computed, and no claim is made that our component matches
either product visually. The implementation below is our work, informed by
public documentation and this captured evidence.

## Public behavioral references

- Apple: https://support.apple.com/en-us/118496
- Google: https://support.google.com/android-xr/answer/16778585?hl=en

Apple describes assisted capture with lighting/alignment guidance, hand setup,
head turns and prompted expressions, per-step audio cues mirrored on the
EyeSight display, accessible skipping (double-click the Digital Crown skips one
expression), and a generated preview before acceptance offering lighting
styles, tone temperature/brightness, optional eyewear, and explicit
Save/Recapture. Google describes companion-phone capture in the Likeness
(beta) app on a compatible Android device while the headset is removed,
generation on the phone, headset preview and management, with small edits
(warmth, brightness, touch-up, background color fill) and synced deletion.
The published app screenshots confirm the split: the phone owns onboarding,
guided capture and expression prompts; the headset only previews, edits
appearance/background and picks the avatar used in calls. Their device
requirements and system defaults are properties of those products, not
requirements or capabilities of our SDK. Captured page text and screenshot
OCR confirm these flows; see the evidence ids above.

These references establish observable product behavior, not either proprietary
model, export format, splat representation or public access to private tracking.

## Our premium component experience

| Stage | User experience | Native ownership / acceptance |
| --- | --- | --- |
| Prepare | Explain capture, show camera preview and lighting/framing cues | Host obtains permission; no capture transition until granted |
| Capture | Calm guided front/profile coverage, expression prompts and optional skip | Host supplies real accepted sample handles; bad quality cannot advance |
| Process | Show actual fitting stages, allow cancellation/retry | Job epochs invalidate late camera/model callbacks; no timer-generated completion |
| Review | Large bust preview, gaze/mouth diagnostic, neutral reference, lighting and tone adjustments | Requires actual generated asset and quality acceptance; no automatic saving |
| Save | Explicitly accept this persona | Old saved avatar survives failed or cancelled recapture |
| Live | Head/gaze/mouth/tongue motion according to detected device capability | Measured/inferred/unavailable signals remain distinct; do not promise unsupported tongue tracking |
| Manage | Recapture, change saved persona, remove its data | Removing native references is separate from deleting files/cloud replicas |

Use NYC-Tron native controls for guide chrome, progress, dialogs, selectors and
accessibility. The bust stays in the native renderer with stereoscopic depth.
No WebView or egui shell is added to the component. Craft Anything is a study
and development tool, not a shipping dependency or a reconstruction model.

Capture source is an adapter, and the observed reference behavior makes the
companion phone the primary capture host: guided capture, expression prompts
and generation run on the phone while the headset previews and manages the
result. A headset camera or supplied image/video may still feed the same
lifecycle, but phone capture is the flow to design for first. A
companion-device handoff needs explicit transfer acknowledgement; account
sync and a system-default avatar cannot be promised until platform-specific
APIs are verified.

For visionOS, distinguish a system Persona virtual-camera presentation from
our independently fitted 3D bust. Neither is proof of access to Apple's mesh
or raw facial sensors. For Galaxy XR, distinguish system Likeness from our
native OpenXR-controlled asset. Public SDK capabilities define integration.

## Implemented and remaining

`capture_session.hpp` now implements native prepare/capture/process/review/save,
quality gates, optional skips, cancellation, generation retry and stale-result
rejection. Its tests also verify recapture preserves the accepted avatar.
This is UI-independent C++ usable without React Native; the existing Nitro v1
bridge does not yet expose this capture controller.

Still needed: real quality evaluator/camera adapter, fitted assets, GNM training
or fitting path, phone/headset transfer, rendered native guide and preview,
appearance editing, persistence deletion, GPU animation and headset testing.
The native state machine does not by itself reproduce either full experience.

Visual verification now covers the reference documentation pages (rendered at
three widths with text, outline and design tokens), the Likeness Play Store
listing at phone width with page source, the compatible-devices page, and the
eight app screenshots Google publishes for the phone capture and headset
preview flows. What remains uncaptured is the live experience itself: real
guided-capture screens, generated avatar preview and live presence require
physical Vision Pro / Galaxy XR hardware or approved reference footage.
Public documentation, page captures and published screenshots are sufficient
for lifecycle semantics, not for a pixel or spatial fidelity claim about
either product's in-device UI.

## Likeness APK structure analysis (2026-11-07)

Source: APKMirror bundle `com.google.android.apps.vr.doppel.apk`
(Likeness beta 2026.10.18, versionCode 2273, arm64-v8a, minSdk 32,
targetSdk 37), SHA-256
`b267100f065caaa5c63beb83b1ec8fffe1b1fdf7acf48b69593cc48e7d107f79`.
Craft Anything 0.5.0 android toolset (`android_package_show`,
`android_components_list`, `android_classes_find`, deep mode) verified the
v2/v3 signature against a Google Inc. Android certificate
(SHA-256 `84468b91530edb3765de0bb71d2658f7f74921563a5d7cfc3697ddf31db84e27`,
valid). This is the genuine signed app, not a repack.

The bundle is an APKM split set (~1.5 GB extracted). Module names reveal the
pipeline:

- `split_doppel_mediapipe.apk` + 313 MB arm64 config: MediaPipe face/landmark
  stack (`libdoppel_mediapipe_jni.so`, facemesh/facedetector `.tflite`,
  `face_model_468/479/6_blazeface.xnft`, region maps, shaders).
- `split_data_process_assets.apk`: `dense599_gnome_itw.tflite`,
  `gnome_hair_predictor`, `hair_landmarks`, `face_light`, `hdrnet`,
  `selfie_multiclass`, `realvatar_gnome_hand/face/upper_body` `.pb` models.
- Encrypted neural modules, one split each: `source_encoder`,
  `base_uv_encoder`, `face_uv_encoder`, `oral_uv_encoder`,
  `wrinkle_uv_encoder`, `wrinkle_weight_predictor`, `feature_decoder` (+DSP).
- `base.apk`: `realvatar_*` runtime configs, `face_blendshape`,
  `face_scan.binarypb`, `effect_realvatar_mirror_bundle.js`,
  `doppel_realvatar_runtime*.binarypb`, Three.js r134 bundle.

DEX classes confirm the architecture: package
`com.google.android.apps.realvatarcreator` with `DataVersionManagerV1-V4`,
`FileDownloader`, `ConditionTracker`; wire protos
`com.google.vr.avatars.realvatars.proto.wire.AvatarSyncPayload` and
`com.google.vr.doppel.common.metadata.RealvatarInfoProto`
(`CaptureInfo`, `CaptureResult.FeedbackEntry`, `DeviceInfo.FormFactor`);
perception protos `GNomeParametersProto`, `GNomeFaceParametersProto`,
`GNomePoseProto`, `GNomeModelSpecProto`, `RealvatarGNomeTrackingProto`,
`GnomeInputLandmarksProto`; and capture-guidance protos
`GuidanceProto`/`GuidanceFeedbackProto`/`FeedbackType`,
`HeadPoseStatus`, `LightingStatus`, `PhonePoseStatus`, `GlassesStatus`,
`RequirementsStatus`, `ActionProto`.

Manifest activities map the phone flow:
`WelcomeActivity → IntroductionActivity → SignInActivity →
ConsentActivity → InstructionsActivity → DataCaptureActivity →
CaptureReviewActivity → DataProcessActivity → TestDriveActivity`, plus
`ManagementActivity`, `LikenessSettingsActivity`, `PrivacyActivity`,
`CloudSyncAcknowledgementActivity`, `RealvatarBackgroundService` and
`AvatarCreationService`.

Interpretation for our pipeline: Google's Likeness is a RealVatar/GNOME
morphable-model avatar, not a Gaussian-splat representation. Capture on the
phone feeds MediaPipe landmarks plus the encrypted UV encoders and feature
decoder to produce morphable-model parameters (GNome* protos), with the
avatar synced to the headset through `AvatarSyncPayload`/
`CloudSyncAcknowledgementActivity`. The guided-capture quality contract is
described by proto messages (lighting/head-pose/phone-pose/glasses/
requirements status + guidance feedback), matching the lifecycle our
`capture_session` models. We cannot reuse Google's encrypted encoder
weights, morphable model data or sync protocol; this analysis defines the
observable contract (stages, statuses, acknowledgement) our native
implementation should mirror, not the proprietary internals.
