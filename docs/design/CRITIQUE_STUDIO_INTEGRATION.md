# Studio surface integration review

2026-11-07. Source review of `engine-studio-surfaces.tsx`, `surface-admission.ts`, the StudioEditor operation owner and the typed Tally/Cadence/Splice adapters. This review does not replace the engine, browser or native acceptance suites.

## Findings addressed before review completion

The initial composition had two consequential failure paths: Cadence/Splice callbacks caught and resolved rejected writes, and Tally could keep an old visible sheet binding writable while the engine's implicit active sheet had already changed. A delayed or failed cell-window refresh made the latter unsafe because `setCell` has no sheet parameter.

The revised source addresses these paths through the existing owner boundary:

- SurfaceAdmission ties a read token to document, source state and viewport scope. Source/disabled changes invalidate readiness. A stale read cannot reopen admission.
- A write lease closes admission synchronously. Duplicate or stale callbacks reject before invoking the write. Failed reads remain readonly; changed-document display data is hidden.
- Tally's active-sheet precheck and actual mutation run inside the same host `perform` operation as Save/Open/history/command actions. A fresh binding, window and workbook confirmation precede renewed write admission.
- The shared host's busy state blocks new admission. It is not rechecked inside an already-admitted write, so that write does not reject merely because its own operation made the parent busy.
- `performSurfaceWrite` releases only the admitted lease and preserves the original rejection. The local `admitted` flag prevents a rejected duplicate callback from clearing another operation's busy state.
- Cadence/Splice promise-bearing callbacks retain failure semantics. Genuinely fire-and-forget boundaries handle their rejected promise after the surface records an error. The host refresh owner is reused rather than acquiring a second nested operation lock.

No self-deadlock or new blocking ownership flaw was found in those revised source paths. This conclusion is limited to the inspected app owner. Other writers of the same document must participate in that coordination; a separate writer could otherwise invalidate Tally's implicit-sheet assumption.

## Verification boundary

The phase report records real-engine adapter tests, four focused admission/rejection regressions and workspace/preview typechecks. This critic inspected the report and implementation rather than independently rerunning those commands. Adapter tests alone do not prove that every rendered control dispatches through the right callback.

The existing alpha.4 controls remain the published dependency. Their older callback contracts are a separate compatibility concern: for example, a control that invokes the same tempo callback from a void tap handler and an awaited numeric edit needs a rejection-safe native/source owner. Swallowing all host rejections to accommodate that handler would undo the error fix above. Keep source-preview checks distinct from the released control, and verify the actual rejected interaction before declaring that compatibility path accepted.

## Remaining visual and product scope

No Tally/Cadence/Splice visual capture was supplied to this critic at the time of this source review. Layout, density, focus, contrast and clipping conclusions therefore remain open for those rendered surfaces. The prior Prism capture does not certify them.

The implementation composes a bounded set of existing document controls. It does not establish complete studio editors, audio output/metronome playback, live meter measurements, decoder presentation, every spreadsheet operation, rich-text authoring, standalone studio installation, native accessibility or performance. The phase report explicitly lists these limits.

Verdict: the identified source-level race and rejection defects are addressed in the reviewed composition. Present the phase as adapter/ownership progress with its actual focused evidence; retain browser interaction, native, release and full studio acceptance gates.

No implementation files, dependencies, app configuration or tests were modified by this review.

## Browser capture and rejection follow-up

The four captures in `evidence/studio-integration` were subsequently inspected directly. They supersede the absence of visual evidence noted above, within their particular browser viewports.

- `tally-formula.png` shows the narrow layout with Sheet1 active, selected A1 displaying 5 and the formula bar displaying `=2+3`. The selected cell, formula and bottom navigation are legible without obvious horizontal page overflow. Only columns A–C are visible, with an explicit sideways-swipe hint; this still does not establish offscreen column access or keyboard behavior.
- `cadence-gain.png` shows 128 BPM and Track 1 at −1.0 dB. Labels and primary controls remain distinct. The channel extends below the captured viewport: its remaining controls and scroll reachability need their own interaction check. Empty mixer space and the unusually wide tempo surface are visual refinement opportunities, not evidence of a failed write.
- `splice-track.png` shows a V1 row beneath the ruler, with document and inspector panels intact. The empty timeline makes this a track-state example, not clip editing or playback proof. Inspector tab captions are truncated at this width; inspect accessible names and provide a readable expanded label or tooltip before treating the panel navigation as finished.
- `cadence-failure.png` visibly retains 120 BPM in both the control and document panels and presents “Review transport failure” beside the control and in the status area. The message is readable; the repeated wording could later be reduced to one persistent error owner with a local indication.

The current tempo wrapper attaches a rejection observer to the task and returns that same task. This handles the alpha.4 void tap-tempo invocation without converting the promise awaited by numeric entry into a successful result. The surface and host retain responsibility for presenting the error. The parent reports an actual numeric submission of 127 with one injected `setTempo` transport rejection: the controlled value remained 120, the error appeared, and no unhandled rejection occurred. This critic inspected the wrapper and failure capture; the interaction and event result are the parent's supplied execution record. The parent also reports edit/undo/redo values of 128/120/128, both typechecks, four admission regressions and the production build passing; these commands were not rerun here.

No additional blocking defect is established by these captures. The clipping and navigation observations above remain bounded follow-up work. This is acceptance of the specific browser composition and error-handling evidence for phase review, not native acceptance, complete studio approval or release certification. Source-preview aliases for canonical controls remain distinct from the published alpha.4 dependency.
