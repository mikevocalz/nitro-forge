# P14 in-place animation update source checkpoint

Pitch now supports `updateAnimation {slide,index,kind?,start_s?,duration_s?}`. It resolves the real slide/animation and validates supplied entrance kind, finite nonnegative start and finite positive duration on a clone before mutation. Object target, animation position and omitted fields remain unchanged. Real edits journal once; empty/equal edits emit no event or journal entry and preserve redo. The existing snapshot shape persists the result.

The typed API and operation roster are updated. The pinned alpha.4 SlideAnimationPane exposes add/remove/preview but no update callback. No unsupported callback was added to its binding; current source/new-release adoption remains separate work.

Regression source checks actual changes, unchanged target/order/other animation, partial preservation, snapshot roundtrip, single undo, invalid targets/patches and no-op/error redo preservation. Cargo test-source compilation, scoped Pitch TypeScript and whitespace checks pass. Tests were not executed under the review gate; native/rendering/presentation acceptance remains open.
