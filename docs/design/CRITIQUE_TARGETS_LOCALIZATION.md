# Target sizing and localized chrome review

2026-11-07. Bounded source-preview follow-up to the Prism density critique. Reviewed the canonical NYC-Tron changes to Button, IconButton and PrecisionScrubber, plus two supplied Chromium captures of a 280px-wide localized fixture. No implementation files were edited by this review.

## Evidence inspected

Private captures opened:

- Normal localized fixture: `argent-screenshot-chromium-cdp-9223-1794057614968-81398.png`.
- Browser text-stress fixture: `argent-screenshot-chromium-cdp-9223-1794057624819-81398.png`.

Both live in the session's private Argent Chromium media directory. They are browser fixtures using aliased canonical source, not the released alpha.4 integration or native device captures.

In the normal image, the German opacity label takes its own line above the numeric field. The fine/coarse helper wraps independently from the range. The stress image keeps the longer label, numeric readout, decrement/drag/increment row and range inside the narrow fixture after the browser text-size override. No joined helper/range text or obvious clipping is visible in these two states.

The parent reports measured targets: Button 280 × 48, IconButton 48 × 48, numeric input 64 × 48, decrement/increment 48 × 48 and slider 172 × 48. It also reports one localized increment from 37 to 38 producing one commit. This critic inspected the images and source, not an independent replay of those measurements/actions.

The new targetSize parameter reaches the scrubber's internal interaction surfaces rather than only the Forge wrapper. This addresses the specific 48px coverage gap identified in the prior comfortable-density screenshot. The localized label/hint API keeps app copy separate from the numeric decimal-input contract.

## Phone Save follow-up

The earlier phone review left Save's accessible discovery and action open despite the visible floppy-disk icon. IconButton now explicitly forwards its required name to both aria-label and accessibilityLabel. The parent reports locating Save by that accessible name and producing a real 349950-byte snapshot from the phone source-preview path.

That resolves the recorded **source-preview browser** discovery/action gap for this run. It does not establish the released pin, VoiceOver/TalkBack, native keyboard focus, process restart or every save failure path. The visual presence of an icon alone remains insufficient evidence.

## Remaining API and matrix limits

- A partial localized-copy field set to undefined can override a default when merged by an object spread. Preserve default action names with nullish-per-field fallback, and reject blank action labels if they would remove the accessible name. The supplied fixture uses actual translations and does not exercise that input.
- Button/IconButton caller styles are merged after the target minima. An explicit smaller minWidth/minHeight can override the requested target. Define this precedence clearly or enforce the floor when targetSize is explicitly supplied before describing it as an unconditional minimum.
- German text labels are not evidence of locale-aware numeric parsing. Decimal entry remains the existing numeric contract.
- Browser CSS text stress is not iPadOS Dynamic Type or Android font scaling. RTL, longer translations, input-method composition, large numeric values and real native screen-reader actions remain unverified.
- The target measurements cover these named fixture controls, not every control in every studio or density.

Verdict: the visible narrow/localized reflow and reported source-preview target/action checks support this bounded implementation step. Retain explicit release and native/accessibility gates; no full localization, comfortable-density or shipping approval is inferred.

## API-edge follow-up

Inspected NYC-Tron commit `5925c5d`. PrecisionScrubber now filters undefined localized fields before merging them with defaults and rejects supplied blank/non-string translations. Button and IconButton apply an explicitly requested target minimum after caller styles; Button also avoids retaining a conflicting default minimum-height class in that mode. The earlier source review points are addressed for these code paths while unspecified target sizing keeps the existing style contract.

The parent reports the UI build and 16 focused tests passed for this commit. This critic inspected the committed source; it did not rerun those commands. These corrections do not extend the measured fixture results to all controls, native accessibility or a released Forge pin.
