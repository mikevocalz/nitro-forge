# @nitro-forge/folio

PDF documents for React Native: create or open a PDF, edit pages, annotations,
forms and encryption, and save real PDF bytes, with a Rust engine on the device.

**Status:** in the v1 release set (`@nitro-forge/ignition` and the seven
engines named in [RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md)).
v1 is not released yet; gate status is in
[v1-readiness.json](../../docs/release/v1-readiness.json). Page rendering
(`./render`) is a separate host service, verified on macOS arm64 dev hosts only.

## Install

Forge is not published to npm. Each release attaches one tarball per package
to its [GitHub Release](https://github.com/mikevocalz/nitro-forge/releases),
with a `SHA256SUMS` file. No release exists yet, so `<version>` below is a
placeholder: replace it with the release version after the first release.

```bash
BASE=https://github.com/mikevocalz/nitro-forge/releases/download/v<version>
pnpm add "$BASE/nitro-forge-ignition-<version>.tgz" "$BASE/nitro-forge-folio-<version>.tgz" \
  react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32 \
  nitro-core@1.0.0-alpha.nightly.136.gdb81de61bd32
```

The two Nitro packages are peer dependencies of `@nitro-forge/ignition`; Folio
itself declares none. Folio depends on `@nitro-forge/ignition`, which is not on
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
import { FolioDocument } from "@nitro-forge/folio";

const host = createNitroHost();
const pdf = await FolioDocument.create(host, 2); // two blank letter pages
await pdf.addAnnotation(0, [72, 700, 200, 20], "Check this figure", "Text");

const bytes = await pdf.save(); // NFD1 snapshot
await pdf.close();

const reopened = await FolioDocument.openSnapshot(host, bytes);
const notes = async () => (await reopened.listAnnotations(0)).data.annots.length;
console.log(await notes()); // 1
await reopened.addAnnotation(0, [72, 650, 200, 20], "Second note", "Text");
await reopened.undo();
console.log(await notes()); // 1
await reopened.redo();
console.log(await notes()); // 2

const file = await reopened.savePdf(); // real PDF bytes
console.log(new TextDecoder().decode(file.bytes.subarray(0, 5))); // %PDF-
await reopened.close();
await host.dispose();
```

`save()` returns the NFD1 snapshot used for undo-safe persistence and
`openSnapshot`. `savePdf()` and `FolioDocument.openPdf(host, bytes, password?)`
read and write PDF files. A corrupt PDF rejects with `EngineError` and opens
nothing. Undo history holds 8 entries, since each one is a whole PDF.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/folio` | `FolioDocument`, the `OPS` name table and the PDF types. |
| `@nitro-forge/folio/office-cluster` | Callbacks for text search results, the annotation toolbar, comment threads and read-aloud. Operations the engine lacks are listed in `FOLIO_DEFERRED_OPS`. |
| `@nitro-forge/folio/render` | **Node only.** `FolioRenderService`, a client for the separate `folio-render` process (pdfium) that returns page pixels, text positions, links and search hits. It needs a pdfium shared library at run time and is verified on macOS arm64 dev hosts only; iOS, Android, web and Windows are not run. |
| `@nitro-forge/folio/transfer` | PDF import and export formats for the file import/export sheet. |

`./render` spawns a child process. The other entry points import no Node
built-ins and no React.

## Reference

- Ops and payloads: [ENGINE_OPS.md, folio-engine](../../docs/ENGINE_OPS.md#folio-engine--folioenginenew)
- The render service: [ENGINE_OPS.md, folio-render](../../docs/ENGINE_OPS.md#folio-render-service--host-side-not-an-engine)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
