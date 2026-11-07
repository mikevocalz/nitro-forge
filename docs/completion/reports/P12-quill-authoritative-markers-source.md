# Quill authoritative list markers

The adapter can now provide actual list marker text when its caller passes the linked NYC-Tron `BULLETS_NUMBERING_CAPABILITIES` value with version 1 and `authoritativeMarkers: true`. Missing, false or unknown capabilities retain the previous mixed-context/nondefault-start rejection. This does not activate the feature on the current alpha.4 pin.

`src/list-markers.ts` derives markers from one complete authoritative block read. It uses stored definition identities, nine levels, configured starts and all six admitted formats. Each explicit instance continues across ordinary paragraphs and other instances. Any shallower item resets deeper counters, matching the admitted Word-default numbering contract documented in P12-quill-list-numbering-source.md. Letters follow Word repeated-letter numbering (z, aa, bb), not spreadsheet columns. Bullets use the actual level-specific glyphs written by Quill's DOCX exporter. Legacy list paragraphs without metadata retain the explicitly admitted bullet0 semantics.

Mixed selections include empty markers for nonlist paragraphs and withhold definition-format and shift callbacks. Kind changes still call the real inclusive-range engine operation. A coherent definition includes preceding same-instance items, so selected later paragraphs retain their correct counters. Refreshes preserve capability admission. Marker text remains separate from body text; no document mutation or literal-prefix serialization is added.

The producer validates definition coherence and existing 256-definition/10,000-list-paragraph budgets. The maximum repeated-letter marker within those budgets fits the UI's 4096 UTF-16-unit bound. No UI helper or React runtime is imported into Forge.

Validation: focused Vitest run for list-markers, office-cluster and nyc-tron-consumer: 16/16 passed; Quill TypeScript passed. Independent expected-value cases cover all formats, configured starts, repeated letters, level resets, interleaved identities, invalid metadata, resource bounds, mixed capability gating and refresh. Native/UI runtime acceptance, release publication and consumer pin updates remain pending.
