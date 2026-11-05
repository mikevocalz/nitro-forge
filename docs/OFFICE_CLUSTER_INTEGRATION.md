# Office cluster: Pitch, Quill and Folio behind NYC-Tron

NYC-Tron UI owns the office controls (PR mikevocalz/NYC-Tron-UI#42). Each
engine package here has an `office-cluster` subpath that turns engine state
into the props those controls take, and turns their callbacks into engine
ops. The adapters import no React and no `@nyc-tron/*` package.

Every binding reads from the engine, and every write goes to the engine
before the binding is read again and handed to `onChanged`. Nothing is
applied optimistically. An engine error rejects with the engine's message,
which the NYC-Tron control shows.

## Bindings

| ID | NYC-Tron control | Adapter | Engine ops used |
| --- | --- | --- | --- |
| J-01 | `slides/SlideFilmstrip` | `@nitro-forge/pitch/office-cluster` `bindPitchSlideList` (`slides`, `onMove`, `onAdd`, `onRemove`) | `describe`, `moveSlide`, `addSlide`, `removeSlide` |
| J-02 | `slides/SlideSorter` | `bindPitchSlideList` (`onReorder`, `onRemoveMany`), `pitchMovePlan` | `moveSlides`, `removeSlides` (one atomic undo step each) |
| J-05 | `slides/SlideCanvas` | `bindPitchCanvas`, `readPitchSlideAt` for animation preview, `PITCH_SLIDE_SIZE` | `moveObject`, `resizeObject`, `rotateObject`, `setText`, `removeObject`, `slideAt` |
| J-09 | `slides/SlideAnimationPane` | `bindPitchAnimations`, `PITCH_ANIMATION_EFFECTS` | `addAnimation`, `removeAnimation` |
| H-03 | `document/RichTextRibbon` | `@nitro-forge/quill/office-cluster` `bindQuillRibbon`; feed `runs` to NYC-Tron `ribbonStateFor` | `blocks`, `applyStyle`, `setBlockKind` |
| H-07 | `document/BulletsNumberingEditor` | `bindQuillList` (kinds `none` and `bullet`) | `setBlockKind` (`list` / `para`) |
| H-15 | `document/NavigationOutline` | `readQuillOutline` (headings, first page, page count) | `blocks`, `layout` |
| H-21 | `document/DocumentReadAloudTransport` | `readQuillReadAloudBlocks` into NYC-Tron `readAloudSentences`; `quillSectionOf` for `describeBlock` | `blocks` |
| K-04 | `pdf/TextSearchResults` | `@nitro-forge/folio/office-cluster` `folioSearchPages` (from the reader's page, wrapping, abortable) into NYC-Tron `findInPageText` and `insertPageHits` | `pageCount`, `pageText` |
| K-06 | `pdf/AnnotationToolbar` | `FOLIO_ANNOTATION_TOOLS`, `addFolioAnnotation`, `bindFolioHistory` | `addAnnotation` (Text, Highlight), `undo`, `redo` |
| K-07 | `pdf/CommentsThreadPanel` | `bindFolioComments` (`threads`, `onDelete`) | `listAnnotations`, `removeAnnotation` |
| K-18 | `pdf/PDFReadAloudTransport` | `readFolioReadAloudBlocks` (block = page index) | `pageCount`, `pageText` |

## Deferred

Each adapter exports a `*_DEFERRED_OPS` map. The keys are engine ops that do
not exist yet, and the values are the roster IDs that need them. The matching
NYC-Tron prop is left out, so the control is not drawn. A unit test in each
package checks that no deferred key is in the engine's `OPS`. When one of
these ops lands, the deferral lifts.

- Pitch (`PITCH_DEFERRED_OPS`):
  - `setSlideSection` (J-01 sections).
  - `setSlideSize` (J-05): the adapter assumes 960 × 540 units.
  - `setObjectOrder` and `setTextStyle` (J-05).
  - `updateAnimation`, `setAnimationTrigger` and `emphasisAndExitEffects` (J-09): `addAnimation` takes fadeIn, slideInLeft and zoomIn only.
- Quill (`QUILL_DEFERRED_OPS`):
  - `setFontFamily`, `setFontSize` and `setHighlight` (H-03): `applyStyle` stores bold, italic, underline, strike, color and link.
  - `changeCase` (H-03): delete-and-insert would drop run styles.
  - `setListFormat` and `setListLevel` (H-07): a `list` block exports as Word's ListParagraph with no numbering definition and no level.
  - `bookmarks` and `renderPage` (H-15).
- Folio (`FOLIO_DEFERRED_OPS`):
  - `renderPage` and `textPositions` (K-04, K-06 and K-18 on-page parts): `pageText` is lossy and has no glyph boxes, so hits and marks can be listed but not drawn on the page.
  - `underlineAnnotation`, `strikeOutAnnotation`, `inkAnnotation` and `shapeAnnotations` (K-06).
  - `annotationAuthor`, `replyAnnotation`, `setAnnotationState` and `setAnnotationContents` (K-07): annotations come back as single comments with no author, replies or resolve.

The office packages pin NYC-Tron UI `v0.1.0-alpha.2`. Each package includes
`nyc-tron-consumer.test.ts` to check its adapter against the released control
props during TypeScript validation. This proves the prop contract, not rendering
or device behavior.

The sorter submits a complete unique slide-ID order or a unique removal set in
one engine call. The engine validates every ID before mutation, rejects removal
of the whole deck, and records one undo entry. Empty removal and unchanged order
emit no event and preserve redo. A stale reorder missing a newly added slide is
rejected rather than silently dropping it. The Rust unit test covers these
cases in the engine, and `packages/pitch/tests/office-cluster.e2e.test.ts`
runs the refusals, the no-ops and undo/redo through `nf-cli`. The adapter
checks duplicates and unknown IDs before the keep-one rule, so a bad ID is
reported as unknown.

## CI

`.github/workflows/office-bridge.yml` does the following:

1. Typechecks the three packages.
2. Runs the mock-document unit tests.
3. Builds `nf-cli`.
4. Runs every Pitch, Quill and Folio test against the real Rust engines,
   including the existing engine e2e suites.

This checks the command protocol on Linux only. It does not cover native
Nitro, Swift, Compose or a device renderer.
