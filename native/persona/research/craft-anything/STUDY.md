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
Their device requirements and system defaults are properties of those
products, not requirements or capabilities of our SDK. Captured page text
confirms these flows verbatim; see the evidence ids above.

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

Capture source is an adapter: a supported headset camera, companion phone or
supplied image/video can feed the same lifecycle. A companion-device handoff
needs explicit transfer acknowledgement; account sync and a system-default
avatar cannot be promised until platform-specific APIs are verified.

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

Visual verification of the reference documentation is now captured (rendered
pages at three widths with text, outline and design tokens, plus the generated
report). What remains uncaptured is the in-device experience itself: the
headset-guided capture screens, generated avatar preview and live presence
require physical Vision Pro / Galaxy XR hardware or approved reference
footage. Public documentation and page captures are sufficient for lifecycle
semantics, not for a pixel or spatial fidelity claim about either product's
in-headset UI.
