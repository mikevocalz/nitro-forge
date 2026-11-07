# Forge revision collaboration service

This Node-only package supplies the durable HTTP backend for
`@nitro-forge/ignition/collaboration-http`. Native/web clients retain one
Rust-owned document per participant. SQLite stores opaque NFD1 revisions with
engine identity; it does not introduce a second editing model.

```ts
import { startCollaborationServer, type CollaborationServerOptions } from "@nitro-forge/collaboration-server";

// Pass your application's identity and document ACL implementation.
export async function openDocumentService(authorize: CollaborationServerOptions["authorize"]) {
  return startCollaborationServer({
    databasePath: "/var/lib/forge/documents.sqlite",
    authorize,
    allowedOrigins: ["https://editor.example"],
  });
}
// await service.close() when the host shuts down.
```

The database directory must exist and belong to this service. The listener binds
loopback unless configured otherwise. Deploy behind the application's HTTPS
proxy; the client rejects remote plain HTTP. No production service is deployed
by importing or testing this package. Authorization is mandatory for GET, HEAD
and PUT and runs before document data is accessed. A thrown or stalled policy
fails closed. Configure exact browser origins; credentialed CORS is opt-in.
The client accepts an app-authorized fetch for header/cookie authentication.

```ts
import { createHttpCollaborationTransport } from "@nitro-forge/ignition/collaboration-http";

const transport = createHttpCollaborationTransport({
  baseUrl: "https://collaboration.example",
  fetch: appAuthorizedFetch,
});
const watch = transport.watch({
  documentId: "project:document",
  afterRevision: document.state.revision,
  onRevision: async () => { await document.syncNow(); },
  onError: error => { showSyncError(error); return "stop"; },
});
// Close the watch before closing the document owner.
await watch.close();
await document.close();
```

Revision notifications poll HEAD metadata (default one second, minimum 250 ms),
so large document snapshots are fetched only when the owner synchronizes. The
owner rejects conflicting local edits; `acceptRemote()` is an explicit discard
choice, never an automatic fallback. On error the app chooses stop or retry.
Watch close aborts network I/O and drains an accepted callback. Transport
requests include a bounded deadline.

Protocol: GET returns a framed binary snapshot and X-Forge-Revision/Engine
headers; HEAD returns metadata without reading the BLOB; PUT carries binary
NFD1, engine identity and X-Forge-Base-Revision. The service commits a SQLite
BEGIN IMMEDIATE transaction before 204 acknowledgement. Stale bases or foreign
engine replacements return 409 plus the current record. WAL/FULL synchronization
and SQLite locking apply across processes. Server framing and size checks run
before writes; engine semantic validation remains in the participant's atomic
restore. No exception text, credential or document contents is echoed on error.

Run `pnpm --filter @nitro-forge/collaboration-server test` with NF_CLI pointing to
a current real engine binary. Tests cover actual HTTP, abrupt server death,
restart persistence, concurrent processes, clean-peer notifications, conflicts,
authorization, CORS, bounds and resource disposal. The native acceptance entry
also drives the real JSI engines against this service on both mobile simulators.
This revision/conflict service leaves the board's existing Yjs ownership intact;
object/text CRDT reconciliation and presence are separate product integrations.

API reference used: [Node 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
Node 24's DatabaseSync name is retained for compatibility with the repository's
Node floor; Node 26 also exposes that API under the newer Database name.
