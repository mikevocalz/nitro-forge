# Ignition third-party materials

Original Forge code uses the repository's MIT license. That grant does not
replace any upstream terms below or the separate licenses on private and
third-party components.

## Generated Nitro bindings

The generated files retain their Margelo/Marc Rousavy copyright headers.
`licenses/Nitro-MIT.txt` reproduces the unmodified upstream license text
from both `nitrogen` and `react-native-nitro-modules` at
`1.0.0-alpha.nightly.136.gdb81de61bd32`:

- https://unpkg.com/nitrogen@1.0.0-alpha.nightly.136.gdb81de61bd32/LICENSE
- https://unpkg.com/react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32/LICENSE
- Both files' SHA256: `833ee7046f3908173364391ad4a2028560029503faf3a29e8acb77506dfe52ea`.

The Nitro runtime remains a separately installed pinned dependency; this
archive does not bundle a second Nitro runtime binary. Generated-source
attribution is preserved separately from Forge's original-code notice.

## Compiled Rust payload

Produced candidates must include `native/licenses/` with the resolved
`nf-sys` normal/build dependency closure, exact Cargo.lock/source checksums,
actual dependency license/notice texts and Rust toolchain notices. The
producer checks the packet and actual packed members before consumption.
Missing or unresolved materials block packaging, including internal test
candidates. A manifest license identifier alone is not a replacement for
the associated copyright, license text and source provenance.

No LibRaw/PDFium linkage is inferred from other workspace renderer crates.
Only the actual resolved `nf-sys` dependency closure selects native packet
components. Private AGPL components do not enter this package inventory.
