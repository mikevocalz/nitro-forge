# N-11 revision collaboration checkpoint

`@nitro-forge/ignition/collaboration` adds `DocumentCollaboration` for the seven
Rust document engines. It owns one document and serializes edits, undo/redo,
reads and sync. Commands are copied at admission with the same bounded plain
JSON validator as gesture previews (100k nodes, depth 64, 1 MiB text). Native
handles, accessors, cycles and non-finite values are rejected.

A host supplies an authenticated `CollaborationTransport`. Its immutable remote
records carry engine kind, positive integer revision and NFD1 snapshot bytes.
Revision zero means no remote document. Its compare-and-swap operation must
atomically check the expected revision and durably store the next revision.
The provider owns authorization, network timeouts and reconnect policy. No
credentials, network service or external sink is created by this implementation.

## Behavior

- New local documents remain dirty until acknowledged. Initialization is absent
  from user history. All edits go through the owner; no raw handle is exposed.
- Sync reads the current revision. A clean peer can adopt a newer snapshot.
  A dirty peer with a different base receives `CollaborationConflict` with both
  revision numbers; its document and undo/redo stay intact.
- Local commits accepted during sync wait behind the revision boundary. Concurrent
  sync callers share one operation. This deliberately trades commit latency for
  a simple authoritative boundary; local preview remains a separate UI concern.
- Compare-and-swap rejection cannot silently overwrite another peer. After a
  network failure, the exact sent bytes are retained. A subsequent read can
  recognize their durable acceptance, even for Folio PDFs whose reserialization
  may differ. Later local edits remain dirty and upload against that recovered
  base. A process restart may require explicit conflict resolution; pending upload
  metadata is not yet durably journaled.
- `acceptRemote()` explicitly discards local changes and resets history. A product
  must obtain the user's discard choice before invoking it. It is never an
  automatic conflict fallback.
- Invalid framing, foreign engine identity and backwards revisions are rejected.
  Rust validates snapshot semantics before replacement. Close drains accepted
  work and closes its document; it leaves the shared host alive.

The board's existing Yjs adapter remains separately owned on its recovered branch.
This implementation does not replace it, wrap whole snapshots in a CRDT, or claim
text/object merging, presence or a deployed collaboration backend. Those remain
N-11/P16 work. Product conflict UI, durable offline upload recovery, network/device
acceptance and performance budgets remain unverified.

## Verification

Nine collaboration tests drive real Rust engines through nf-cli and an explicit
in-memory transport contract fixture. They cover all seven engines, two-client
conflicts, clean revision adoption, lost durable ACKs, later local edits, Folio
reserialization, CAS races, owned queued commands, drain/close and invalid remote
records. These are real engine checks, not deployed server or native JSI evidence.

The tests exposed Folio/Pitch retaining history across restore. Both now clear
history only after successful decoding. A Rust regression exercises every engine:
failed restore preserves history; successful replacement clears undo and redo.
The full Rust workspace passes 348 tests. Native archives and installed apps built
before this change do not contain that new Folio/Pitch fix.
