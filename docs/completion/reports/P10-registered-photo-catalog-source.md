# P10 registered photo catalog source

Added the real `photo-engine` Rust state machine and typed `@nitro-forge/photo` API. This slice stores original descriptors, ratings/labels and version identities; it does not implement RAW decoding/develop/rendering, asset storage or a default UI product. Descriptors are host-claimed; the engine does not verify content hashes or asset existence. Duplicate original SHA-256 values reject. Removing a catalog original removes associated metadata/versions only and never deletes host bytes.

The engine validates complete candidate state before committing one journal entry. Snapshot payloads explicitly require kind photo/schema1, reject unknown fields, foreign payloads, invalid references/counters/metadata and encoded states over 8 MiB. Limits include 10,000 originals, 100,000 total versions, 1..100 versions per original and 16 history entries. Arc-backed states/records share unchanged metadata; changed records use copy-on-write. Logical limits are not a measured RSS claim. Reads/noops preserve history; batches stage through the same validation and commit atomically. Successful restore clears prior history; failed restore leaves state/history intact.

Registration appends Photo/photo to Rust/CLI/FFI factories and TS kinds. Fixed NFC1/NCC1 tags 0..6 remain unchanged; photo is 7. Installed pinned Nitro v1 nitrogen was invoked directly, without a package-manager install/prehook, producing PHOTO=7 while preserving existing ordinals. C++ factory opens the registered name on the existing owned async worker. FFI signatures/layouts and NFD1 framing remain unchanged. No binary-input op is admitted. Existing native binaries still need rebuilding before photo native support can be claimed.

Focused verification:

- Seven photo crate tests passed and cover catalog/version identity, metadata, undo/redo/reopen, duplicate hash policy, invalid/noop history, atomic batches, foreign/malformed/oversized restore, descriptor/counter/reference limits, 8 MiB state budget and 16-entry history with shared immutable records.
- One focused nf-sys v1 factory/binary test passed: it opens photo and confirms unsupported input fails without mutation.
- Two focused registration tests passed: they check every persisted engine tag/native ordinal and CLI photo persistence/foreign restore rejection.
- Photo and Ignition TypeScript typechecks pass; nf-cli builds. No broad P19 matrix or native consumer build ran.

This package is source-added to the existing workspace globs; no dependency install or application selection was performed. Release manifests/pins remain unchanged. Full P10 requires durable host originals, admitted decoder worker/job integration, actual decode metadata verification and broader photo operations; neither catalog-only registration nor the separate LibRaw/Prism prototype closes that work. No phase/component acceptance is promoted.

Independent review found asynchronous caller-buffer ownership needed tightening. PhotoDocument now delegates snapshot opening to the shared owning DocumentHandle.openSnapshot helper. Added delayed-allocation regression source proving caller mutations and neighboring backing-buffer bytes cannot alter the restored snapshot, plus failed-restore session cleanup. Added only the new photo workspace importer (existing Ignition workspace link and TypeScript 7.0.2) to the current lockfile; no dependency install or baseline lockfile rewrite.

After the shared helper landed, all three focused PhotoDocument ownership tests passed (Uint8Array subview, Node Buffer subview, failed-restore cleanup), and the photo TypeScript typecheck passed. The shared helper and older engine wrapper audit are recorded separately by the integration owner.

Integration-owner verification also passes all 10 ignition-core, 20 nf-sys and 7 photo-engine Rust tests (37 total), plus the three ownership tests and 15 affected registration/autosave/collaboration checkpoint tests. This broader shared-boundary check does not constitute the native platform matrix. The isolated lock importer is included in the same source checkpoint.
