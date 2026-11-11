# Photo catalog and decoded preview processing

Photo owns original/version descriptors, ratings, labels and persistent version recipes. Original files, verified content identity, durable retention and decoding remain host-owned.

`setDevelop` persists bounded exposure, contrast, RGB gains and optional white balance (`temperature_kelvin` 2000–40000 K via a declared sRGB blackbody-ratio approximation, plus `tint` −1..1 green trim). `processPreview` applies them to packed straight-alpha sRGB RGBA8 with an explicit original/version/hash/recipe match. Identity preserves every byte; other recipes preserve alpha. Input/output is limited to one megapixel. The JSON facade copies the caller's subview before awaiting; the existing native binary command path accepts owned bytes directly.

This is decoded-pixel processing, with no RAW decoder, ICC/profile conversion, lens correction or complete RAWDevelopPanel binding. The Kelvin control is a bounded approximation, not color-managed white balance. Older catalog versions default to identity recipes. History, snapshots and rejected edits retain the shared document contract.

Run `pnpm test:completion-backends` from the repository root for the focused Rust and source/CLI suites. These checks do not establish native consumer or full P10 acceptance. See [the source report](../../docs/completion/reports/P10-nondestructive-develop-preview-source.md).
