# @nitro-forge/quill

Rich text documents for React Native: paragraphs, headings, lists, styles,
tables, comments, tracked changes and DOCX import and export, edited by a Rust
engine on the device.

**Status:** in the v1 release set (`@nitro-forge/ignition` and the seven
engines named in [RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md)).
v1 is not released yet; gate status is in
[v1-readiness.json](../../docs/release/v1-readiness.json).

## Install

Forge is not published to npm. Each release attaches one tarball per package
to its [GitHub Release](https://github.com/mikevocalz/nitro-forge/releases),
with a `SHA256SUMS` file. No release exists yet, so `<version>` below is a
placeholder: replace it with the release version after the first release.

```bash
BASE=https://github.com/mikevocalz/nitro-forge/releases/download/v<version>
pnpm add "$BASE/nitro-forge-ignition-<version>.tgz" "$BASE/nitro-forge-quill-<version>.tgz" \
  react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32 \
  nitro-core@1.0.0-alpha.nightly.136.gdb81de61bd32
```

The two Nitro packages are peer dependencies of `@nitro-forge/ignition`; Quill
itself declares none. Quill depends on `@nitro-forge/ignition`, which is not on
npm either, so point that dependency at the same tarball in
`pnpm-workspace.yaml`:

```yaml
overrides:
  "@nitro-forge/ignition": https://github.com/mikevocalz/nitro-forge/releases/download/v<version>/nitro-forge-ignition-<version>.tgz
```

Check each tarball against the release's `SHA256SUMS` before you commit the
lockfile. The engine runs inside the Ignition Nitro module, so the app needs a
native development build; Expo Go cannot load it.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { QuillDocument } from "@nitro-forge/quill";

const host = createNitroHost();
const doc = await QuillDocument.open(host);
await doc.insertText({ block: 0, offset: 0 }, "Hello world");
await doc.applyStyle({ block: 0, offset: 0 }, { block: 0, offset: 5 }, { bold: true });

const bytes = await doc.save(); // NFD1 snapshot
await doc.close();

const reopened = await QuillDocument.openSnapshot(host, bytes);
const text = async () => (await reopened.text()).data.text;
console.log(await text()); // Hello world
await reopened.insertText({ block: 0, offset: 11 }, "!");
await reopened.undo();
console.log(await text()); // Hello world
await reopened.redo();
console.log(await text()); // Hello world!

const docx = await reopened.exportDocx(); // .docx bytes
const imported = await QuillDocument.openDocx(host, docx);
console.log((await imported.text()).data.text); // Hello world!
await imported.close();
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged. A
position is `{ block, offset }`; inserting `\n` splits a block.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/quill` | `QuillDocument`, the `OPS` name table and the document types. |
| `@nitro-forge/quill/office-cluster` | Callbacks for the rich-text ribbon, list editor, navigation outline and read-aloud. Operations the engine lacks are listed in `QUILL_DEFERRED_OPS` and get no callback. |
| `@nitro-forge/quill/transfer` | DOCX import and export formats for the file import/export sheet. |

None of these import React or a UI package.

## Reference

- Ops and payloads: [ENGINE_OPS.md, quill-engine](../../docs/ENGINE_OPS.md#quill-engine--quillenginenew)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- Third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
