# Roster decisions, 2026-11-11

Replaces the 2026-11-05 roster status (`roster-status.tsv`, 341 rows). Row-level data is in [ROSTER-2026-11-11.tsv](ROSTER-2026-11-11.tsv).

## Counts

| Status | Rows |
| --- | ---: |
| VERIFIED | 0 |
| WIRED | 35 |
| BUILT-SOURCE | 301 |
| ABSENT | 5 |
| Total | 341 |

| Decision (non-WIRED rows) | Rows |
| --- | ---: |
| BUILD | 247 |
| DEFER | 56 |
| STRIKE | 3 |
| No decision needed (WIRED) | 35 |
| Total | 341 |

No row is VERIFIED. No file under `docs/completion/evidence` (forge or NYC-Tron-UI) names a roster component, and unit tests are not counted without a run. 79 rows are named in a NYC-Tron-UI test file (`test_refs` column); none of those tests were run here.

The 2026-11-05 TSV lists 181 ABSENT rows; its summary markdown says 222, and the two disagree. 180 of the 181 TSV rows now have a component file and a package export (the file exists in the NYC-Tron-UI clone; PR #54 contains them). The five rows that are ABSENT today are N-01, N-03, N-04, N-09 and N-19: no file carries those names.

## How status was set

Each status comes from checks run against forge `codex/complete-all-components-merged-20261111` (82f793d) and the NYC-Tron-UI PR #54 clone at `/Users/mikevocalz/recovered-work/2026-11-05/tron-complete` (HEAD d4f22b4, contains PR head d5207cc). The clone was read, not modified or fetched.

- **ABSENT**: `library-progress.json` lists no source file, or the file is missing, or no package `exports` entry (or `src/index` re-export) reaches it. Five forge-native rows (N-10, N-11, N-15, N-16, N-18) use a forge file instead: `packages/ignition/src/{autosave,collaboration,transactions,v1-host}.ts` and `packages/telemetry/src/index.ts`. Existence checked; exports not checked for these.
- **BUILT-SOURCE**: the file exists and is exported. Nothing ran it.
- **WIRED**: the component name (or its PascalCase file name) appears in a non-test file under `apps/studio-preview/src`. This is a word match, not a call-graph check. `apps/studio-preview` pins the `v0.1.0-alpha.4` tarball of `@nyc-tron/ui`, so a WIRED row built after alpha.4 imports from a release that may not contain it.
- **VERIFIED**: reserved for a named receipt in `docs/completion/evidence` or a named passing test. Zero rows qualify.
- **Decisions** (product-decisions triad): BUILD when the engine op or provider named in the blocker column exists in `docs/ENGINE_OPS.md` or in source. For 190 decided rows the `basis` column is `grep`: each listed op was found backticked in its ENGINE_OPS engine section, or the absence claim was a zero-hit grep. For 116 rows the basis is `read`: judged from a decision doc, backlog or provider source I read, with no grep that could fail. Treat `read` rows as claims to re-check.
- A BUILD decision means a component exists and the data path exists in source. It does not mean the path works on a device. Providers added in NYC-Tron-UI `platform-services` (speech, encoder, audio device, decoder) are source with unit tests; their commits label them unverified.

## Changes since 2026-11-05

Several blockers named in the 2026-11-05 roster no longer hold:

- **Engine ops now present**: prism transform/selection/brush/stroke ops, splice markers/transitions/loop range/track flags/ripple/roll/slip/slide/speed keys/batch, tally formats/validation/sort/filter/charts/pivots/sparklines/sheet views/comments/import, quill styles/tables/sections/comments/revisions/TOC/mail merge/findText, pitch masters/connectors/transitions/notes/charts, folio page/outline/form/attachment/encrypt/redact ops, photo catalog and develop ops, motion keyframes/effects/mattes/3D/particles/render queue, design-engine, draft-engine, scene-engine.
- **Host providers now present**: `rust/folio-render` (bound in `packages/folio/src/render.ts`), `rust/scene-render` (bound in `packages/scene`), `rust/nf-raw` (bound in `packages/photo/src/raw.ts`), NYC-Tron-UI `platform-services` speech, encoder, audio, media decoder, scheduler and media-cache.
- **Still unbound**: `rust/nf-color` and `rust/splice-render` have 0 references in forge `packages/` and `apps/`.

## 3D re-check: the 14 "no 3D engine" STRIKE rows

`rust/scene-render` (CPU rasterizer) and `scene-engine` (tag 11) exist, so the stated STRIKE condition is gone for all 14 rows. Five of the 14 (M-13 to M-17) never depended on a 3D renderer: they map to `draft-engine`, a 2D drafting engine.

| Row | Component | Old | New | Reason |
| --- | --- | --- | --- | --- |
| M-01 | Native3DViewport | STRIKE | BUILD | None in ENGINE_OPS; wire to scene renderFrame/pick; scene-render CPU rasterizer is the display path. |
| M-02 | ViewCubeAndAxisGizmo | STRIKE | BUILD | None in ENGINE_OPS; wire to camera node setTransform. |
| M-03 | TransformGizmo3D | STRIKE | BUILD | None in ENGINE_OPS; wire to setTransform/pick. |
| M-04 | UVEditor | STRIKE | BUILD | None in ENGINE_OPS; wire to updateMesh uvs_b64 (edit supplied UVs; UV packing is not available). |
| M-05 | TextureSetPanel | STRIKE | BUILD | None in ENGINE_OPS; wire to material texture reference. |
| M-06 | PBRMaterialInspector | STRIKE | BUILD | None in ENGINE_OPS; wire to material fields (render is a Phong approximation of PBR). |
| M-07 | TextureBrush3D | STRIKE | DEFER | scene pick returns node, mesh, triangle, distance, point and normal but no UV, and no texture-write path exists; paint-on-mesh needs both. |
| M-08 | TextureMaskAndGenerator | STRIKE | DEFER | scene-render lists node-material DAG and procedural texturing as still deferred. |
| M-09 | BakingMapPanel | STRIKE | STRIKE | No baking pipeline: scene-render lists baking among the still-deferred items and no scene op produces a baked map. Return when a bake op exists. |
| M-13 | DraftingCommandLine | STRIKE | BUILD | None in ENGINE_OPS; wire to draft executeCommand (2D draft engine, not 3D). |
| M-14 | ObjectSnapsAndOrtho | STRIKE | BUILD | None in ENGINE_OPS; wire to snap ops (draft engine). |
| M-15 | DimensionsAndHatching | STRIKE | BUILD | None in ENGINE_OPS; wire to dimension/hatch ops (draft engine). |
| M-16 | PaperSpaceLayout | STRIKE | BUILD | None in ENGINE_OPS; wire to sheet/viewport ops (draft engine). |
| M-17 | ParametricConstraintEditor | STRIKE | BUILD | None in ENGINE_OPS; wire to constraint/solve ops (draft engine). |

Net: 11 of 14 move to BUILD, 2 (M-07, M-08) to DEFER, and M-09 stays STRIKE on a new precondition (no baking pipeline). E-33 and E-36 stay STRIKE.

## BUILD

### A Studio shell (27)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| A-01 A-02 A-03 A-04 A-05 A-06 A-07 A-08 A-09 A-10 A-11 A-12 A-13 A-14 A-15 A-16 A-17 A-18 A-19 A-21 A-23 A-25 A-27 A-28 A-30 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |
| A-26 | Progress and cancel exist: __batch/apply_long run on a scoped progress window and packages/ignition/src/specs/ForgeTask.nitro.ts exists; wire the toast to task progress (tron platform-services/scheduler implements LongTaskScheduler). |
| A-29 | None in ENGINE_OPS; wire to quill findText/replaceText (tally has no find op; scope is quill only). |

### B Canvas/layers (25)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| B-01 | None in ENGINE_OPS; wire to renderRegion. |
| B-02 | View state only; no engine dependency. |
| B-03 B-04 B-05 B-08 B-09 B-10 B-19 B-24 B-27 B-28 B-30 B-31 B-34 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |
| B-06 | None in ENGINE_OPS; wire to prism transform ops. |
| B-07 | None in ENGINE_OPS; wire to prism selection ops. |
| B-11 | None in ENGINE_OPS; wire to setLayerBlend/setLayerOpacity. |
| B-15 B-16 B-17 B-18 B-29 B-33 | None in ENGINE_OPS; wire to brush/stroke ops. |
| B-26 | None in ENGINE_OPS; wire to crop (ratio presets and straighten are host-side math; no straighten op). |

### C Color (11)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| C-02 C-03 C-04 C-05 C-06 C-18 C-26 C-27 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |
| C-11 | None in ENGINE_OPS; wire to samplePixels (document sampling, not screen). |
| C-16 | None in ENGINE_OPS; wire to setFill (solid/linear/radial paint). |
| C-24 | Decode path exists: platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt). Scope, probe and sync math runs host-side on decoded frames/PCM. Provider is unverified on devices beyond fixture receipts. |

### D Video/timeline (26)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| D-01 | Native decode surface has P03 iOS and Android player receipts; wire the component to it. |
| D-02 D-05 D-26 D-40 D-42 | Decode path exists: platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt). Scope, probe and sync math runs host-side on decoded frames/PCM. Provider is unverified on devices beyond fixture receipts. |
| D-04 D-06 D-07 D-08 D-12 D-15 D-19 D-25 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |
| D-09 | Step and reverse-scrub via decodeFrame at presentation-index positions (platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt)); no claim of real-time reverse playback. |
| D-13 | None in ENGINE_OPS; wire to splice loop range ops. |
| D-16 | Decode path exists: platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt). Peaks and filmstrip tiles are computed host-side from DecodedAudio/DecodedFrame. E-02 Skia GPU lane stays deferred. E-03 shows decoded channels (cadence render itself is stereo-only). |
| D-17 | Decode path exists: platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt). Peaks computed host-side from DecodedAudio. |
| D-18 | None in ENGINE_OPS; wire to setTrackFlags. |
| D-20 D-22 | None in ENGINE_OPS; wire to splice ripple/move ops. |
| D-21 | None in ENGINE_OPS; wire to roll/slip/slide ops. |
| D-29 | Encoder provider exists (platform-services ./encoder, tests/encoder.test.mjs, MP4 via WebCodecs on web, native muxers). Scope: monitor encodes of decoded sources; a composited program export still lacks a TS binding for rust/splice-render (0 hits). |
| D-32 | None in ENGINE_OPS; wire to setSpeedKeys. |
| D-33 D-34 | Speech provider exists (platform-services ./speech: createSpeechRecognizer, consent, SpeechWord timings; tests/speech.test.mjs). On-device quality unverified. |

### E Audio (16)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| E-01 E-04 E-07 E-08 E-32 E-38 | Audio device provider exists (platform-services ./audio: device probe, PCM playback/capture streams, stats; tests/audio.test.mjs). Commit 797e310 labels it unverified; no device receipt names these components. |
| E-02 E-03 | Decode path exists: platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt). Peaks and filmstrip tiles are computed host-side from DecodedAudio/DecodedFrame. E-02 Skia GPU lane stays deferred. E-03 shows decoded channels (cadence render itself is stereo-only). |
| E-14 | None in ENGINE_OPS; wire to cadence mixer ops. |
| E-15 E-18 E-26 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |
| E-31 | Decode path exists: platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt). Scope, probe and sync math runs host-side on decoded frames/PCM. Provider is unverified on devices beyond fixture receipts. |
| E-35 | None in ENGINE_OPS; wire to detectBeats. |
| E-37 | Speech provider exists (platform-services ./speech: createSpeechRecognizer, consent, SpeechWord timings; tests/speech.test.mjs). On-device quality unverified. |
| E-39 | None in ENGINE_OPS; wire to insert preset ops. |

### F Photo/RAW (12)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| F-01 F-02 F-03 F-18 | None in ENGINE_OPS; wire to photo catalog ops (no separate flag op: flag maps to labels). |
| F-04 | None in ENGINE_OPS; wire to processPreview with the nf-raw provider (packages/photo/src/raw.ts). |
| F-05 | None in ENGINE_OPS; wire to develop recipe exposure_ev/temperature_kelvin/tint. |
| F-12 | None in ENGINE_OPS; wire to flatten; before/after pairs from photo createVersion or prism snapshots. |
| F-13 F-17 | None in ENGINE_OPS; wire to photo develop recipes; presets stay host JSON. |
| F-14 | None in ENGINE_OPS; wire to encodePng (PNG only; no JPEG or metadata-strip op). |
| F-15 | None in ENGINE_OPS; wire to photo version ops. |
| F-16 | None in ENGINE_OPS; wire to brush/stroke ops. |

### G Motion/compositing (14)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| G-01 | None in ENGINE_OPS; wire to composition/layer ops. |
| G-02 G-03 G-04 | None in ENGINE_OPS; wire to setPropertyKeys. |
| G-05 | No engine dependency (easing curves are pure math); wire the gallery to motion interpolation names. |
| G-06 | None in ENGINE_OPS; wire to setMotionPath. |
| G-07 | None in ENGINE_OPS; wire to setLayer3D. |
| G-09 | None in ENGINE_OPS; wire to setLayerMatte (painted masks not in the model). |
| G-10 | None in ENGINE_OPS; wire to setLayerEffects (6 effect kinds). |
| G-11 | None in ENGINE_OPS; wire to setExpression. |
| G-12 | None in ENGINE_OPS; wire to particle ops. |
| G-13 | None in ENGINE_OPS; wire to setSpeedKeys. |
| G-14 | None in ENGINE_OPS; wire to setGraph (M-10..M-12 follow G-14). |
| G-15 | None in ENGINE_OPS; wire to render queue ops. |

### H Documents (18)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| H-03 | None in ENGINE_OPS; wire to applyStyle font_family/font_size/highlight and changeCase. |
| H-04 | None in ENGINE_OPS; wire to font ops. |
| H-05 | None in ENGINE_OPS; wire to named-style ops. |
| H-06 | None in ENGINE_OPS; wire to setParagraphFormat. |
| H-07 | None in ENGINE_OPS; wire to list ops. |
| H-08 H-09 | None in ENGINE_OPS; wire to table ops. |
| H-10 H-11 H-12 H-20 | None in ENGINE_OPS; wire to section ops. |
| H-13 | None in ENGINE_OPS; wire to comment ops. |
| H-14 | None in ENGINE_OPS; wire to revision ops. |
| H-15 | None in ENGINE_OPS; wire to bookmark ops and renderPage thumbnails. |
| H-16 H-17 | None in ENGINE_OPS; wire to TOC field ops. |
| H-19 | None in ENGINE_OPS; wire to mail-merge ops; records come from the host. |
| H-21 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |

### I Spreadsheets (19)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| I-01 I-02 I-03 I-06 I-20 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |
| I-04 | None in ENGINE_OPS; wire to named-range ops. |
| I-05 | None in ENGINE_OPS; wire to functionCatalog. |
| I-07 | None in ENGINE_OPS; wire to fillRange/fillSeries. |
| I-09 I-10 I-16 | None in ENGINE_OPS; wire to format ops. |
| I-11 | None in ENGINE_OPS; wire to validation ops. |
| I-12 I-21 | None in ENGINE_OPS; wire to sort/filter ops. |
| I-13 | None in ENGINE_OPS; wire to chart ops. |
| I-14 | None in ENGINE_OPS; wire to setSparkline. |
| I-15 | None in ENGINE_OPS; wire to pivot ops. |
| I-18 | None in ENGINE_OPS; wire to comment ops. |
| I-19 | None in ENGINE_OPS; wire to import ops. |

### J Slides (15)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| J-01 | None in ENGINE_OPS; wire to addSection/updateSection (no setSlideSection op; sections are boundary objects). |
| J-02 J-14 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |
| J-03 J-04 | None in ENGINE_OPS; wire to master/placeholder ops. |
| J-05 | None in ENGINE_OPS; wire to size/order/text-style ops. |
| J-06 | None in ENGINE_OPS; wire to addShape (bounded preset set). |
| J-07 | None in ENGINE_OPS; wire to connector ops. |
| J-08 J-10 | None in ENGINE_OPS; wire to transition/timing ops. |
| J-09 | None in ENGINE_OPS; wire to animation ops. |
| J-11 J-13 | None in ENGINE_OPS; wire to notes ops. |
| J-15 | Decode path exists: platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt). Scope, probe and sync math runs host-side on decoded frames/PCM. Provider is unverified on devices beyond fixture receipts. |
| J-16 | None in ENGINE_OPS; wire to chart objects (data copied from tally by the host). |

### K PDF (18)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| K-01 K-02 K-03 | None in ENGINE_OPS; wire to folio-render via packages/folio/src/render.ts (macOS arm64 RUN, other targets NOT-RUN). |
| K-04 K-05 | None in ENGINE_OPS; wire to folio-render textPage/search plus folio addAnnotation. |
| K-06 | None in ENGINE_OPS; wire to annotation ops. |
| K-07 | None in ENGINE_OPS; wire to comment-thread ops. |
| K-08 | None in ENGINE_OPS; wire to ink annotation / insertPageImage. |
| K-09 | None in ENGINE_OPS; wire to form ops. |
| K-10 K-11 | None in ENGINE_OPS; wire to page ops. |
| K-12 K-13 | None in ENGINE_OPS; wire to outline ops. |
| K-15 | None in ENGINE_OPS; wire to encrypt/decrypt. |
| K-16 | None in ENGINE_OPS; wire to comparePdf plus folio-render renderPage. |
| K-18 | None in ENGINE_OPS; wire to textPage; speech output is host OS TTS. |
| K-19 | None in ENGINE_OPS; wire to attachment ops. |
| K-20 | None in ENGINE_OPS; wire to insertPageImage; camera capture is host-side. |

### L UI design (14)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| L-01 | None in ENGINE_OPS; wire to frame/component ops. |
| L-02 | None in ENGINE_OPS; wire to auto-layout ops. |
| L-03 | None in ENGINE_OPS; wire to axis sizing ops. |
| L-04 | None in ENGINE_OPS; wire to constraint ops. |
| L-05 | None in ENGINE_OPS; wire to component/instance ops. |
| L-06 | None in ENGINE_OPS; wire to variable bindings; no dedicated style-set op, styles map to variables. |
| L-07 | None in ENGINE_OPS; wire to variable/mode ops. |
| L-08 | None in ENGINE_OPS; wire to prototype ops. |
| L-09 | None in ENGINE_OPS; wire to interaction ops. |
| L-10 | None in ENGINE_OPS; wire to resolvePrototypeEvent; playback state is host-owned. |
| L-11 | None in ENGINE_OPS; wire to prototypeGraph. |
| L-12 | None in ENGINE_OPS; wire to describeHandoff. |
| L-14 | None in ENGINE_OPS; wire to comment thread ops. |
| L-15 | None in ENGINE_OPS; wire to exportSlice. |

### M CAD/3D (14)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| M-01 | None in ENGINE_OPS; wire to scene renderFrame/pick; scene-render CPU rasterizer is the display path. |
| M-02 | None in ENGINE_OPS; wire to camera node setTransform. |
| M-03 | None in ENGINE_OPS; wire to setTransform/pick. |
| M-04 | None in ENGINE_OPS; wire to updateMesh uvs_b64 (edit supplied UVs; UV packing is not available). |
| M-05 | None in ENGINE_OPS; wire to material texture reference. |
| M-06 | None in ENGINE_OPS; wire to material fields (render is a Phong approximation of PBR). |
| M-10 M-11 M-12 | None in ENGINE_OPS; wire to setGraph (M-10..M-12 follow G-14). |
| M-13 | None in ENGINE_OPS; wire to draft executeCommand (2D draft engine, not 3D). |
| M-14 | None in ENGINE_OPS; wire to snap ops (draft engine). |
| M-15 | None in ENGINE_OPS; wire to dimension/hatch ops (draft engine). |
| M-16 | None in ENGINE_OPS; wire to sheet/viewport ops (draft engine). |
| M-17 | None in ENGINE_OPS; wire to constraint/solve ops (draft engine). |

### N Platform/infra (18)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| N-01 | No engine dependency and no source file; create the pointer router in forge-native code. No source file exists yet. |
| N-02 N-05 N-06 N-07 N-08 N-12 N-13 N-14 N-16 N-17 N-18 N-20 N-21 | No engine blocker found in the 2026-11-05 roster or ENGINE_OPS; wire into apps/studio-preview. |
| N-10 | Source exists (packages/ignition/src/autosave.ts) and every engine answers __snapshot; wire autosave into studio-preview. |
| N-11 | Source exists (packages/ignition/src/collaboration.ts, packages/collaboration-server) with P02 restart/conflict receipts; wire the adapter into studio-preview. |
| N-15 | None in ENGINE_OPS; wire to __batch transaction boundary. |
| N-19 | No file or export carries the name NativeMediaDecoderSurface; the decode surface exists as platform-services media decoder (createMediaDecoder: probe, decodeFrame, decodeAudio, presentation index; exported ./media; unit-tested by tests/media.test.mjs, fixture decode receipts P03-ios-media.txt and P03-android-media.txt). Add a named export over it. No source file exists yet. |

## STRIKE

### E Audio (2)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| E-33 | Precondition still fails: cadence render returns channels:2 (stereo only). Return when cadence gains multichannel. |
| E-36 | Precondition still fails: no licensed SFX catalog and 0 sfx/sound-effect source hits in packages/ and apps/. Return when a catalog is licensed. |

### M CAD/3D (1)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| M-09 | No baking pipeline: scene-render lists baking among the still-deferred items and no scene op produces a baked map. Return when a bake op exists. |

## DEFER

### A Studio shell (2)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| A-22 | No asset-index op: photo-engine indexes photo originals only; no engine or provider lists project media. MediaCache (platform-services ./media-cache, ForgeMediaCache.nitro.ts) is a keyed byte cache, not an index. |
| A-24 | No history-read op: ENGINE_OPS line 27 says __undo/__redo/__snapshot are host-handled and no op lists journal entries. |

### B Canvas/layers (1)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| B-32 | Timelapse replay needs a history-read op: none exists (ENGINE_OPS line 27 leaves __undo/__redo host-only). Encoder provider exists (platform-services ./encoder). |

### C Color (13)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| C-07 C-08 C-09 C-10 C-25 | rust/nf-color (moxcms ICC provider) exists but nothing in packages/ or apps/ references it (0 TS/JSON hits), so no host binding carries conversions to the UI. |
| C-14 C-15 | Schema decision open: documents carry no token or spot color IDs (no such field in any engine section of ENGINE_OPS). |
| C-17 | prism setFill paints solid/linear/radial only; no mesh-gradient paint type. |
| C-19 | No histogram op in any engine section of ENGINE_OPS (0 matches). |
| C-20 C-21 C-22 C-23 | No levels/curves/HSL/color-grading op: prism applyFilter takes grayscale/invert/brightness; motion effects add contrast and blur; photo develop schema1 is exposure_ev, contrast, rgb_gain, temperature_kelvin, tint. |

### D Video/timeline (9)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| D-03 D-28 | rust/splice-render compositor exists (P08-splice-compositor-decision) but has no TS/Nitro binding (0 hits for splice-render in packages/ and apps/); D-28 also has no cache index. |
| D-27 | No multicam model: 0 matches for multicam or sync in the splice section. |
| D-30 | No picture-in-picture provider: only the UI component references PictureInPicture; no Swift, Kotlin or TS binding in tron or forge packages. |
| D-35 D-39 | No tracking op: motion and splice sections have no subject-tracking op and no vision backend exists. |
| D-36 | No stabilization op in any engine section (0 matches). |
| D-38 | splice has no effect model (0 matches for effect in the splice section); motion setLayerEffects belongs to motion layers. |
| D-43 | splice addTrack kinds are video/audio/overlay; no effects, adjustment or sticker track kind and no clip transform op. |

### E Audio (10)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| E-06 | Decision open: record-arm as host-only state or as a cadence track field; the cadence section has no arm op (0 matches for setTrackArm). |
| E-09 | cadence has resizeClip/splitClip but no fade op on clips (the only fade hits in the cadence section are automation prose). |
| E-10 E-28 | cadence clips carry constant gain_db only; no per-clip gain envelope and no take/playlist model. |
| E-16 | cadence meter op is offline over a tick range; no live audio graph to meter. |
| E-29 | Punch-in needs engine-scheduled transport and a punch range op: cadence has neither (0 matches for punch in the cadence section). |
| E-30 | No sampler op in the cadence section (0 matches). |
| E-34 E-40 | No ML audio backend: no speech-separation or denoise op or provider exists. |
| E-41 | No sidechain or ducking op in the cadence section (0 matches). |

### F Photo/RAW (6)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| F-06 | photo develop schema1 has exposure_ev and contrast only; no highlights, shadows, clarity or vibrance fields. |
| F-07 | No levels/curves/HSL/color-grading op: prism applyFilter takes grayscale/invert/brightness; motion effects add contrast and blur; photo develop schema1 is exposure_ev, contrast, rgb_gain, temperature_kelvin, tint. |
| F-08 | No lens-correction field in photo develop schema1 or any engine op. |
| F-09 F-10 F-11 | photo develop schema1 is a global recipe with no mask field; prism paintMask/addMask act on prism layers, not photo versions (P10-photo-masks is UI only). |

### G Motion/compositing (1)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| G-08 | motion setLights exists but no camera op: P11-motion-camera-decision.md defers camera/perspective. |

### H Documents (4)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| H-01 H-02 H-22 | IME composition bridge design open (forge #45 gap); quill ops cover text edits but no native IME-aware text bridge exists. |
| H-18 | No spellcheck/grammar op in quill; spellcheck backend not chosen. |

### J Slides (1)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| J-12 | No external display routing: 0 matches for external or display in the pitch section; needs a host display adapter. |

### K PDF (3)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| K-14 | redactRect removes intersecting annotations and fully contained images only; text in page content streams is not removed (result carries content_note), so an irreversible apply claim would be false. |
| K-17 | No PDF/A writer is admitted (P15 backlog); folio-render gives renderPage but no print or PDF/A export path. |
| K-21 | No content-stream text-edit op in folio. |

### L UI design (1)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| L-13 | Presence transport not built: STATUS.md lists realtime merging and presence as later work; collaboration-server covers restart/conflict only. |

### M CAD/3D (2)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| M-07 | scene pick returns node, mesh, triangle, distance, point and normal but no UV, and no texture-write path exists; paint-on-mesh needs both. |
| M-08 | scene-render lists node-material DAG and procedural texturing as still deferred. |

### N Platform/infra (3)

| Rows | Blocker or action (decided 2026-11-11) |
| --- | --- |
| N-03 | Logitech Muse SDK not integrated and SDK-backed 6DoF diagnostics need hardware. |
| N-04 | No palm-rejection or prediction code: 0 hits for "palm" in packages/spatial-ink and packages/native-signal; needs on-device stylus input. |
| N-09 | No per-target XR renderer adapters (Viro, visionOS, PICO); no source file exists. |

## Rows with no decision

WIRED rows need none: A-20 B-12 B-13 B-14 B-20 B-21 B-22 B-23 B-25 C-01 C-12 C-13 D-10 D-11 D-14 D-23 D-24 D-31 D-37 D-41 E-05 E-11 E-12 E-13 E-17 E-19 E-20 E-21 E-22 E-23 E-24 E-25 E-27 I-08 I-17.

## Not checked

- No build, test or device run happened for this change. Claims about behavior come from source and docs, not execution.
- The local NYC-Tron-UI clone is PR #54 at d4f22b4; it was not fetched, so later pushes to that PR are not reflected.
- Export checks follow `package.json` `exports` keys and `src/index` re-exports by name match.
- The `ops_checked` column lists only the ops I chose as the dependency for each family. A row can depend on more than I listed.
