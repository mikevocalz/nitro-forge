# Persona experience study — Craft Anything

## Actual tool execution

Craft Anything 0.5.0 Linux CLI was downloaded from the official release and
verified against its SHA256SUMS.txt. Archive SHA256:
`d18c54ef05e5c7ef50f8c4959fee8983c0a4a1f141edc488d11f7029973c885b`.
Source: https://github.com/storytold/craft-anything/releases/tag/v0.5.0
The tool was run independently, not copied into the premium component.

Ran `core_brief_write`, then the MCP tools `web_site_open`, `web_site_capture`
and `core_report_write` in clean-room mode against the official pages below.
The brief/report succeeded. Browser launch failed with `socket() failed:
Operation not permitted`; capture therefore returned `no website is open`.
The generated report correctly reported zero evidence records and zero findings.
**No screenshots, app inspection or visual similarity score were produced.**
No external AI builder was launched. The implementation below is our work,
informed by public documentation independently retrieved through web research.

## Public behavioral references

- Apple: https://support.apple.com/en-us/118496
- Google: https://support.google.com/android-xr/answer/16778585?hl=en

Apple describes assisted capture with lighting/alignment guidance, head movement
and expression prompts, accessible skipping, and a generated preview before
acceptance. Users can adjust appearance or recapture. Google describes companion
phone capture, generation and headset preview, with appearance/background edits
and avatar selection for calls. Their device requirements and system defaults
are properties of those products, not requirements or capabilities of our SDK.

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

Visual verification remains blocked until Craft Anything can capture approved
reference footage or app screens in an environment with a working browser or
connected target device. Public documentation was sufficient for lifecycle
semantics, not for a pixel or spatial fidelity claim.
