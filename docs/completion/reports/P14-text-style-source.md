# P14 atomic text-style source checkpoint

Pitch now supports partial `setTextStyle {slide,id,font_size?,bold?,italic?,color?}` edits on text objects. The engine validates target and every supplied field on a cloned TextProps value before recording history. Sizes are finite and positive, toggles are booleans, and RGBA channels are four integers in 0..255. Successful edits preserve text content and all omitted style fields, journal once and persist through existing snapshots. Empty/equal patches emit no event and preserve redo; invalid patches leave state/history intact.

The typed API and operation roster are updated, and the obsolete engine deferral is removed. The released SlideCanvas has no style callback, so app inspector adoption and actual typography/rendering acceptance remain open. No unsupported widget props were invented.

Added regression source covers multi-field atomicity, single undo, partial preservation, invalid inputs and targets, no-op/error redo preservation and snapshot restore. `cargo check -p pitch-engine --tests`, scoped Pitch TypeScript checking and whitespace checking passed. Independent source review found no blocker. The tests compiled but were not executed under the review gate; no runtime/native acceptance is claimed.
