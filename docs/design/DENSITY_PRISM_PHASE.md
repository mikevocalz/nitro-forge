# Density and real Prism task

2026-11-07. This phase implements controlled density and moves the material comparison into the actual Rust-backed Prism editor. Workbench remains the provisional default; no direction selection or suite-wide acceptance is implied.

## Implementation

`studio-workspace/theme` exports compact, standard and comfortable scales. Standard preserves the existing metrics. Type scale and radii stay stable; density is independent of device layout. Comfortable increases host control targets to 48pt, but reusable controls with their own fixed internals still require an explicit target contract. This is not a claim of universal 48pt coverage.

`ForgeWorkspace` accepts density and an optional change callback, exposed in the existing Workspace menu. Prism consumes that scale for editor chrome and accepts the existing material directions. No engine handles enter serialized state. The comparison uses a per-instance Zustand store and changes presentation without remounting the document. The turret fixture links to `#/lab/prism`; the real route provides material, density and theme choices above the editor so they do not crowd its header.

The browser RN adapter explicitly exports Platform and PanResponder, matching RN Web's exports. No native window, orientation, manifest, dependency or lockfile changes are part of this phase.

## Focused evidence

`cargo build --locked -p nf-cli`, both studio-workspace and studio-preview TypeScript checks, and whitespace checks passed. The real local CLI bridge completed: create rectangle layer 2; set opacity 37%; undo to 100%; redo to 37%; save a 350278-byte NFD; change to 82%; reopen the saved NFD and restore 37%. All nine material/density combinations retained layer 2 and 37%, with one engine-open operation and no page exceptions. See the sanitized `evidence/density-prism/workflow-source.json`. The file round trip and screenshots demonstrate this path, not every operation or recovery case.

The comfortable inspector revealed joined help/range text in published NYC-Tron alpha.4. Its canonical PrecisionScrubber footer now wraps bounded text with explicit gaps, committed upstream as `068101f`. NYC-Tron's UI build passed. The committed images use a temporary local source-leaf alias to demonstrate that correction; they are **source previews, not the currently pinned release**. The private alias configuration and third-party reference images are not included. The accepted release/pin update remains separate.

Phone (390 × 844) and light portrait (834 × 1194) source previews are included. Phone document scroll dimensions equal the viewport, and the Fill action is within its bounds. These captures use the initial document; the nine landscape workflow captures contain the edited rectangle. Phone Save visibility, enlarged text/localization, full keyboard and screen-reader flows, native input/material behavior and complete comfortable target coverage remain outside acceptance. Browser warnings include RN Web accessibility-attribute and Animated fallback notices; no warning-free claim is made.

Full suites and native acceptance remain deferred for user review. Published alpha.4 stays unchanged. See the independent `CRITIQUE_DENSITY_PRISM.md` for the bounded visual assessment and remaining gaps. Existing unrelated native-cadence/media work is excluded from this commit.
