# F4: accepted earlier iPhone Duo references

Date: 2026-11-13. Decision by the repository owner in the current Codex chat:
**"Accept the earlier iPhone Duo captures".** This is the owner's explicit
answer to whether F4 should keep looking for iPad references or use the
earlier iPhone Duo captures. No further confirmation of this choice is pending.

Inspected repository baseline: `a58994d4802de2db9067ae3cbe824912c4a50b9c`.

## Accepted capture basis

| Existing original Forge file | Capture context from the historical record | Asset pixels | SHA-256 |
| --- | --- | --- | --- |
| `design/icons/renders/device/2026-11-11-base-0ad4ed2-ios27-duo-inner-home.png` | 2026-11-11; base `0ad4ed22f7523d4dcf16574a57ea62b067d264da`; suite and seven studios beside earlier builds | 1400 × 985 | `208e0edd7adaf4709b0e1ffe8800a67bdee77825d95228323422254a4fd48fae` |
| `design/icons/renders/device/2026-11-12-27eafbb-ios27-duo-inner-home-all-apps.png` | 2026-11-12; source `27eafbb0b921d38853e79d6f15704001255f1534`; all eleven Forge launcher labels | 1200 × 843 | `f4f1e94d560bafa9fc4159a5b2dbf8d307916f2af0961031cc086543b727c6f4` |

Both are landscape image assets from the **Forge Completion iPhone Duo**
simulator's inner panel, recorded as iOS 27.1 in
[APP-IDENTITY-3.3.md](APP-IDENTITY-3.3.md#5-frontend-designfrontend-design).
Asset pixel dimensions are not a new measurement of device geometry. The
first filename records a base revision, not a clean capture checkout; its
exact working-tree identity is not retained. The
historical report identifies stub launcher bundles carrying the real display
names, bundle identifiers and compiled icons. It does not record a stub app
version or show the real studio apps running.

Both files were opened for this documentation pass. The first shows eight
Forge product labels alongside truncated older build labels; the later one
shows those products plus Audio Lab, Media Lab and Cadence QA, each on one
line at the captured settings. This is a visual observation of those assets,
not a fresh launcher measurement or a claim about other devices.

The owner accepts this existing basis for the F4 launcher-reference device
choice. The files remain iPhone simulator evidence. They are not relabelled
as iPad captures, physical-device results or app-runtime acceptance.

## Scope of the decision

- The F4 choice between further iPad reference searching and the earlier
  iPhone Duo launcher captures is resolved in favour of the latter.
- Neither home-screen image shows About, a studio title bar or a lab header.
  The three-references-per-surface count and those surfaces' coverage are not
  claimed complete by this decision.
- The global 11in/13in portrait/landscape matrix and `phase0Status` in
  [reference-index.json](../docs/design/reference-index.json) stay unchanged.
  Its official gallery URLs, hashes, review flags and missing native captures
  remain historical records. This decision is indexed separately as F4-only.
- Third-party gallery images and private design-pack assets stay outside the
  public repository. No restricted image is copied or newly claimed reviewed.
- F4's acceptance text, the gate validator and its status values stay intact.
  F4 remains incomplete, without a reviewer signature. Owner distribution
  approval for a stable release is a separate exact-version/checksum gate.

## Remaining F4 criteria at the inspected baseline

| F4 criterion | What the inspected source or historical record contains | What remains |
| --- | --- | --- |
| Names, identifiers and icon configuration | `design/APP-IDENTITY.md` maps the suite, seven studios, two labs and Cadence QA to brand manifests; the brand plugin sets names, identifiers and icon assets | Bind resolved configs and built labels/icons to the actual release candidate on the claimed platforms. These two stub captures do not establish that real studio apps launch |
| Tron's T3 rendered-width check | App-identity workflow explicitly says it will adopt the check after the rc.2 pin | Integrate the check with F2 and retain deliberately long-name failures plus the required platform measurements. Character counts are not a rendered-width pass |
| Original icon family and small-size critique | Eleven icons have 16/32/60/1024 renders and a shared construction; the historical critique calls out Cadence versus Cadence QA at 16 px | Owner's distinctness decision for Cadence QA and the Pitch/Prism naming question remain separate; Android launcher comparison and applicable platform captures are still needed |
| §3.3 implemented surfaces | Historical research, token, copy, contrast, critique and handoff records exist; the owner has now chosen the reference-device basis | About/title-bar and lab-header reference/render coverage, applicable accessibility interaction and independent review remain. No new design-skill run is claimed here |
| Separately installable/rebrandable studios | `FORGE_BRAND`, manifests, surfaces modules and `rebrand-check.mjs` exist. CI defines suite/Prism prebuild/web checks, other harness prebuild checks, and renamed Audio Lab native builds | Candidate-bound rebrand and native build evidence for the actual claimed studio scope; do not extrapolate an Audio Lab build to every studio |
| Name replacement in permission copy | `apps/forge-audio-lab/app.json` still hardcodes `Allow Nitro Forge to record audio for your project.` | Review and test permission-copy branding in the implementation work; this docs-only decision does not fix it |
| About presentation and shared radius | About labels and values currently both use `colors.text`; the historical pass defers its 4 px outer-card radius to F8 | Keep the label/value presentation decision and F8 radius work separate from reference acceptance |

No native builds, prebuilds, rebrand exports, launcher sessions or screen-reader
checks were run for this documentation change. Existing records describe their
own commits; they do not certify the current candidate.
