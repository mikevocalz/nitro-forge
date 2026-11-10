# Focused P12–P14 engine checks

The user selected the first three work groups, including backend/document work through P17. Focused checks now execute the affected Tally, Pitch and Quill engine regression suites.

- Pitch: 23 unit tests pass, including object order, partial text styles, animation updates and persisted slide size.
- Quill: 41 unit tests pass, including exact font-family/size/RGB-shading DOCX roundtrips, invalid-input atomicity and undo/redo.
- Tally: 44 unit tests pass, including sheet order/tone/duplication/protection, identity/history and ID exhaustion. Three old exact workbook expectations were updated to include the documented tone:null and is_protected:false fields; product output and assertions were not weakened.

The first combined `cargo test -p tally-engine -p pitch-engine -p quill-engine` passed Pitch/Quill and exposed those Tally expectation mismatches. After updating them, `cargo test -p tally-engine` passes all 44. Total affected engine coverage is **108 passing unit tests**. The affected Pitch adapter file also passes nine Vitest tests. TypeScript checks pass. Quill retains the existing unused base64_encode warning.

These tests run Rust document/DOCX behavior and controlled typed adapters. They do not prove native typography/shaping, player/recording, rendering/provider delivery, accessibility, full platform acceptance or release. No phase/platform acceptance field is promoted.
