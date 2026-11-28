# Importer fuzzing

Every engine entry point that parses bytes a user can hand us (a file they
open, a project snapshot, an image or font they drop in) has a
[cargo-fuzz](https://rust-fuzz.github.io/book/cargo-fuzz.html) target in
[`fuzz/`](../../fuzz). The targets run on a schedule and on pull requests
that touch an importer (see [What CI runs](#what-ci-runs)).

## Targets

| Target | Entry point under test | Seeds |
| --- | --- | --- |
| `xlsx_import` | Tally `importXlsx`, then `describe`, `getRange`, snapshot round trip, `exportXlsx` re-import | `empty.xlsx`, `cells.xlsx` exported by Tally |
| `docx_import` | Quill `importDocx`, then `describe`, `text`, `layout`, snapshot round trip, `exportDocx` re-import | `empty.docx`, `rich.docx` exported by Quill |
| `font_register` | Quill `registerFont`; on success `insertText`, `layout` and `renderPage` with the font, on failure the font list must stay empty | `packages/quill/rust/tests/fixtures/nftestmono.ttf` |
| `pdf_open` | Folio `open`, every read op (`pageCount`, `info`, `describe`, `listPageInfo`, `listOutlines`, `listFormFields`, `listSignatures`, `listAttachments`, `pageText`, `listAnnotations`), snapshot round trip, `save` re-open | Folio's PDF fixtures (blank, annotated, encrypted, forms, signatures) |
| `pdf_compare` | Folio `comparePdf` against a two-page document | same as `pdf_open` |
| `pdf_page_image` | Folio `insertPageImage`: the first byte picks PNG, JPEG or raw samples (raw width, height and colour space come from its other bits); on success `save` re-open | hand-made PNG (palette, all five filters), JPEG header, raw RGB |
| `nfd1_envelope` | ignition-core `decode_envelope` and `base64_decode`; whatever decodes must re-encode to the same bytes | one snapshot per engine, a base64 string |
| `snapshot_restore` | `restore` of every engine (the first byte picks one of the 12); a refused snapshot must leave the engine unchanged, an accepted one must round-trip | one snapshot per engine plus an encrypted Folio one |
| `icc_profile` | nf-color `Profile::from_icc`, `info`, and a `Transform` to and from sRGB in `u8` and `f32` | the ICC fixtures in `rust/nf-color/tests/fixtures` (the 557 KB CMYK profile is left out) |
| `raster_input` | Motion `addRasterAsset` and Prism `addRasterLayer` + `drawPixels` with caller-supplied RGBA; input is `[selector][width u16][height u16][pixels]` | 2x2 frames for each engine, a zero-width frame |

Seeds live in `fuzz/seeds/<target>/` and are committed (about 350 KB in
all). libFuzzer writes the corpus it grows to `fuzz/corpus/<target>/` and
crashing inputs to `fuzz/artifacts/<target>/`; both are git-ignored.

### What every target checks

A target fails on more than a panic. The shared helpers in
[`fuzz/src/lib.rs`](../../fuzz/src/lib.rs) assert that:

- a refused input returns an `EngineError` that is `recoverable` and not
  `ErrorCode::Internal`;
- a refused command leaves the engine's snapshot byte-for-byte unchanged;
- an accepted input survives `snapshot -> restore -> snapshot` with
  identical bytes;
- whatever an export (`exportXlsx`, `exportDocx`, `save`) writes imports
  again.

Resource use is bounded by the run flags: 2 GB RSS (`-rss_limit_mb=2048`),
10 s per input (`-timeout=10`) and 256 KB inputs (`-max_len=262144`). An
importer that allocates far more than its input, or loops, fails the run as
an OOM or a timeout.

### Not covered

- `folio-render` needs the pdfium shared library at run time.
- `nf-raw` and `raw-decode` link LibRaw, which the build fetches from
  libraw.org.
- `splice-render` and `scene-render` are host services. They take engine
  output and media the host has already decoded, not user files.
- Pitch has no PPTX import and Cadence has no audio-file decoder (it
  renders `f32` PCM it is given), so neither has a file target beyond
  `snapshot_restore`.

## Running a target

You need a nightly toolchain and cargo-fuzz (Linux or macOS; libFuzzer needs
a sanitizer-capable target):

```sh
rustup toolchain install nightly-2026-11-28 --profile minimal
cargo install cargo-fuzz --locked --version 0.13.2

cd fuzz
cargo +nightly-2026-11-28 fuzz list
mkdir -p corpus/pdf_open
cargo +nightly-2026-11-28 fuzz run pdf_open corpus/pdf_open seeds/pdf_open -- \
  -max_total_time=60 -rss_limit_mb=2048 -timeout=10 -max_len=262144
```

Pass the corpus directory first: libFuzzer writes new inputs to the first
directory it is given, so the committed seeds stay as they are.

To reproduce or minimize a crash:

```sh
cargo +nightly-2026-11-28 fuzz run pdf_open artifacts/pdf_open/crash-<hash>
cargo +nightly-2026-11-28 fuzz tmin pdf_open artifacts/pdf_open/crash-<hash>
```

The
[libFuzzer options reference](https://llvm.org/docs/LibFuzzer.html#options)
lists every flag after `--`.

## When a target finds something

Treat it as an importer bug, not a fuzzer problem:

1. Reproduce it with the command above and minimize it with `fuzz tmin`.
2. Fix it in the importer: return a typed `EngineError` (`Validation` or
   `Serialization`, `recoverable: true`) and bound any allocation by the
   input's size.
3. Copy the minimized input into that crate's own tests and add a test that
   runs it through the same oracle, so `cargo test` catches a regression
   without nightly. Folio's are in
   `packages/folio/rust/tests/fuzz-regressions/` and run from
   `packages/folio/rust/src/load.rs`.

### Found so far

| Found by | Bug | Fix | Regression test |
| --- | --- | --- | --- |
| `pdf_open`, `snapshot_restore` | A PDF with a cross-reference stream grew by one object id on every snapshot, because lopdf keeps the `/Type /XRef` stream in `max_id` but never writes it back | `load::normalize` drops xref streams and recomputes `max_id` | `xref_stream_file_snapshot_is_stable` (`signatures.pdf`, `xref-stream-max-id.pdf`) |
| `pdf_open` | A damaged PDF with an `0 0 obj` in its body: the first save wrote object 0 and the reload dropped it, so the first snapshot never matched later ones | `load::normalize` drops object number 0, the free-list head | `object_zero_is_dropped_on_load` (`object-zero.pdf`) |
| `snapshot_restore` | A locked (encrypted) file with no readable objects was accepted; its next save had a trailer pointing at nothing and could not be restored | `load::check_reloadable` requires a catalog dictionary and a resolvable `/Encrypt` | `locked_file_without_catalog_is_refused` (`locked-no-catalog.nfd1`) |

## Adding a target

1. Add `fuzz/fuzz_targets/<name>.rs`:

   ```rust
   #![no_main]
   use libfuzzer_sys::fuzz_target;
   use nf_fuzz::{apply_atomic, binary, check_round_trip, read};
   use serde_json::json;

   fuzz_target!(|data: &[u8]| {
       let mut engine = some_engine::SomeEngine::new();
       // Checks the error and that a refusal left the engine unchanged.
       if apply_atomic(&mut engine, binary("importThing", json!({}), data)).is_none() {
           return;
       }
       read(&mut engine, "describe", json!({}));
       check_round_trip(&engine, some_engine::SomeEngine::new());
   });
   ```

2. Add a `[[bin]]` entry for it in [`fuzz/Cargo.toml`](../../fuzz/Cargo.toml)
   (with `test = false`, `doc = false`, `bench = false`), and the engine's
   crate under `[dependencies]` if it is new.
3. Put a few small valid inputs in `fuzz/seeds/<name>/`, taken from the
   crate's test fixtures. Keep the whole seed set to a few MB.
4. Run it for at least 60 s locally, fix what it finds, and list the
   target in the table above.
5. If the importer lives in a path the workflow does not watch yet, add the
   path to `on.pull_request.paths` in
   [`.github/workflows/fuzz.yml`](../../.github/workflows/fuzz.yml).

`fuzz/` is its own Cargo workspace (the root `Cargo.toml` excludes it) with
its own `Cargo.lock`, so stable `cargo test --workspace` never builds it.
After a dependency bump in the root lock, copy the shared versions across
with `cp Cargo.lock fuzz/Cargo.lock` and run `cargo +nightly fuzz build`
in `fuzz/` to resolve the fuzz-only crates.

## What CI runs

[`.github/workflows/fuzz.yml`](../../.github/workflows/fuzz.yml) runs on:

- a pull request that changes `fuzz/`, `rust/ignition-core/`,
  `rust/nf-color/`, any `packages/*/rust/`, `Cargo.lock` or the workflow;
- every Tuesday at 05:41 UTC;
- a manual dispatch, which takes the number of seconds per target as input.

The job installs the pinned nightly and cargo-fuzz, builds every target,
then runs each one for 60 s (or the dispatch input) from the committed
seeds with the flags above. It runs every target even after one fails and
fails at the end if any did. On failure it uploads `fuzz/artifacts/` as the
`fuzz-artifacts` artifact (kept 30 days); download it and reproduce with
`cargo fuzz run <target> <file>`. The corpus is not cached between runs, so
each run starts from the seeds.

## Toolchain

The workflow pins `nightly-2026-11-28` and cargo-fuzz 0.13.2 so that a
broken nightly cannot fail the job on its own. Move the nightly forward on
purpose: change `NIGHTLY` in the workflow and the commands in this file,
build every target locally, and run them once.

## References

- [Rust Fuzz Book: cargo-fuzz](https://rust-fuzz.github.io/book/cargo-fuzz.html)
- [libFuzzer documentation](https://llvm.org/docs/LibFuzzer.html)
- [RUSTSEC-2026-0187](https://rustsec.org/advisories/RUSTSEC-2026-0187.html),
  the lopdf advisory that Folio's move to lopdf 0.47 cleared
