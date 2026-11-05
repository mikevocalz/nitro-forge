# Universal Board — MMKV + Yjs offline-first implementation

**Scope:** `@nitro-forge/board` is the single product-neutral canvas/ink SDK for QuickDraw whiteboards, PixForge/Prism drawing, PDF annotation, educational boards, presentation markup and XR surfaces. QuickDraw is an optional document adapter, not a requirement for all users of the canvas. **Status: implementation in draft PR #19**, not enabled in Moyo or published to npm.

## Primary requirement: offline must survive app termination

Native drawing without a WebView is helpful for input latency and XR/pen compatibility, but **does not by itself enable offline data durability**. We must preserve complete local Yjs/QuickDraw content while disconnected and after force-quit. The existing Moyo Learn `board-doc.ts` and `board-session.ts` already own Yjs CRDT merges, local-author undo, document session registry and remote reconciliation. Keep those semantics, not two competing documents.

### Where the current source of truth lives

- [Moyo `board-doc.ts`](https://github.com/mikevocalz/moyolearn/blob/main/packages/app/features/tutor/board-doc.ts): existing `Y.Doc`, `Y.Map` keyed by record ID, `encode/merge`, `onRecords`, local-only `UndoManager`. The native renderer is a **derived** view of this one board.
- [Moyo `board-session.ts`](https://github.com/mikevocalz/moyolearn/blob/main/packages/app/features/tutor/board-session.ts): one registry/session across pane, sheet and XR route; keep board alive while mounted and isolate session IDs.
- [Moyo `board-storage.ts`](https://github.com/mikevocalz/moyolearn/blob/main/packages/app/features/tutor/board-storage.ts): MMKV/localStorage persistence and best-effort remote HTTP merge; current shared `problemStorage` key is **not account-scoped**, a classroom privacy/isolation risk also demonstrated by Moyo's `board-session.test.ts`. Migration must read legacy data only for a validated signed-in owner and never automatically expose one learner's data to another.
- [Moyo `native-board.native.tsx`](https://github.com/mikevocalz/moyolearn/blob/main/packages/app/features/tutor/native-board.native.tsx): the current experimental native board **still mirrors input into a second QuickDraw session** while the WebView remains in the render path. Removal of the mirror and full native parity is a separate Moyo consumer PR.
- [Margelo MMKV v4 `set/getBuffer`](https://github.com/margelo/react-native-mmkv/blob/v4.3.2/packages/react-native-mmkv/src/specs/MMKV.nitro.ts): `set(key, ArrayBuffer)` and `getBuffer(key)` provide a binary persistent key/value port.
- [Yjs](https://docs.yjs.dev/api/document-updates): whole-document state updates merge commutatively, distinct from JSON replacement. Do not restore a CRDT by overwriting its map with an older JSON snapshot.

## Implemented, portable SDK entrypoints

| Public subpath | Purpose / dependencies |
| --- | --- |
| `@nitro-forge/board` | Existing QuickDraw/XR renderer binding, optional framework-agnostic contracts |
| `@nitro-forge/board/scene` | New `compileUniversalCanvasScene`: **generic ordered paths** with bounded coordinates, validated paint and all-or-nothing fallback, for photo/vector/PDF/slide editors |
| `@nitro-forge/board/ink` | Reused original PR #16 pressure segments, aspect-preserving projection and pointer mapping, pure TS |
| `@nitro-forge/board/skia` | Existing Skia 3 scene compiler, input router and projection (no eager GPU import) |
| `@nitro-forge/board/skia/native` | Native Skia v3 Graphite presentation and input, guarded fallbacks |
| `@nitro-forge/board/native` | Existing Android Viro+Nitro v1 renderer, not a universal 2D implementation |
| `@nitro-forge/board/offline` | Document-neutral serialized checkpoint/revision/ACK controller |
| `@nitro-forge/board/offline/mmkv` | Account-scoped binary MMKV v4 adapter with one-key checkpoint envelope, CRC32 corruption guard and typed port; no direct native module import |
| `@nitro-forge/board/offline/yjs` | Adapts an **existing** Yjs board document, no new `Y.Doc` or undo stack; local save, remote CRDT merge, subscribed autosave, sync receipts and unsaved-state protection |

No SQLite adapter is part of this architecture. No backend network call or WebSocket provider is created inside the SDK. The host owns identity, encrypted storage choices, transport, reconnection, and history/collaboration permissions.

## Offline lifecycle

```text
Host authentication determines tenant/learner ID + board ID
       ↓
Existing MMKV v4 instance and account-scoped key
       ↓
Load and verify binary Yjs checkpoint before canvas mounts
       ↓
Existing BoardDoc Y.Doc / Y.Map is restored (origin: restore)
       ↓
QuickDraw / drawing editor produces one transaction
       ↓
Yjs onRecords / update observer schedules a local MMKV save
       ↓
Only a resolved MMKV storage write may be called "saved locally"
       ↓
Renderers (Skia v3 / Android XR / Web) read derived state
       ↓
If disconnected: continue drawing, keep needsSync=true
       ↓
When online: sync app-owned Yjs update, await server ACK
       ↓
Persist syncedRevision only if no unpersisted in-memory edits
```

### Example integration with Moyo's existing BoardDoc (adaptation pattern, NOT wired yet)

```ts
import { createMMKVBoardStorage } from "@nitro-forge/board/offline/mmkv"
import { createLocalYjsBoardSession } from "@nitro-forge/board/offline/yjs"

// Both MMKV and boardDoc are already owned by the host application.
// The scope must distinguish signed-in account + organization.
const storage = createMMKVBoardStorage(mmkv, {
  scope: `${organizationId}/${learnerId}`,
})
const persisted = createLocalYjsBoardSession({
  documentId: boardSessionId,
  document: boardDoc, // existing Y.Doc wrapper — NOT a second document
  storage,
  subscribeChanges: (save) => boardDoc.onRecords((_diff, origin) => {
    if (origin !== "restore") save()
  }),
  onPersistenceError: (error) => showBoardUnsavedState(error),
})
await persisted.initialize()

// Browser/native/XR views subscribe to the same boardDoc.
// Local edits persist asynchronously, never require the network.
// Before declaring sync, require that local save succeeded.
if (!persisted.hasUnpersistedChanges) {
  const unsynced = persisted.pendingUpdate()
  if (unsynced) {
    const revisionSent = persisted.lastReceipt!.revision
    await appOwnedYjsTransport.sendAndAcknowledge(unsynced)
    await persisted.acknowledgeSync(revisionSent)
  }
}
```

This *does not* imply WebSocket/Hocuspocus collaboration is already deployed. Moyo currently uses best-effort whole-document Yjs state transfers over HTTP, and the old `pushRemoteBoard` swallows network errors. Real-time user presence, authorization, update ACK contracts, server-side persistence and multi-peer session tests are separate tasks.

## Checkpoint format and crash safeguards

- Each stored MMKV key is `nitroforge.board.v1/<encoded account scope>/<encoded board ID>`; never use the same unscoped key for shared classroom devices.
- Each binary value stores magic/schema, bounded local revision, last remotely ACKed revision, payload length, CRC32 and one complete encoded Yjs update in a **single MMKV set**. CRC catches torn/truncated/corrupt data, **not intentional tampering**. App must choose encryption and secure key lifecycle.
- One key write finishes synchronously in MMKV v4 before the persistence Promise resolves. This is **not** proof of fsync durability against physical power loss; verify force-stop, process kill, app reinstall, OS background pressure and device-specific MMKV semantics.
- A failed save leaves the Yjs document modified **in memory** and explicitly unsaved; Yjs cannot be rolled back safely by applying an older CRDT update. Show unsaved/error state and retry; do not claim it was saved or successfully synced.
- Sync acknowledgements are **revision-specific** and cannot mark newer offline edits as already uploaded. A timed-out or rejected server transfer remains pending.
- Invalid checkpoint versions or CRC failure must preserve the original bytes and surface recovery/repair; never silently reset the student's work to blank.
- Snapshot cap defaults to 32 MiB; do not use MMKV blindly for arbitrarily large media attachments. Keep image/video assets in separate app-private file storage with durable references; their persistence ordering needs its own tests.

## Offline / collaboration / canvas acceptance matrix

| Case | Required proof | Current evidence |
| --- | --- | --- |
| Open, edit, close and reopen with **network disabled** | same Yjs records, no WebView mirror | Pure Yjs/MMKV fixture tests, native device NOT RUN |
| Kill between two writes | last completed checkpoint retained, unsaved state reported | Fake MMKV failure tests, real process kill NOT RUN |
| Two learners on one classroom tablet | fully separate scoped keys, no data leak | MMKV scoped key tests; Moyo legacy migration NOT RUN |
| Yjs remote edits while offline | deterministic union, no overwrite; local-only undo | Yjs merge tests and Moyo existing BoardDoc tests |
| Local storage failure | no false "saved", no false cloud ACK, retry after repair | Unit tests, real native device NOT RUN |
| MMKV checkpoint corruption/truncation | explicit recoverable error, retain original bytes | Unit tests |
| QuickDraw→Skia v3 same scene | native ink, colors, geometry and unsupported fallback | TS scene tests; physical GPU pixel parity NOT RUN |
| PixForge/PDF/Slides generic board | feed original generic paths without QuickDraw Store | Generic scene compiler tests; consuming app NOT RUN |
| iPad/Android foldable pointer geometry | no stretching; pressure preserved | Pure geometry tests; physical devices NOT RUN |
| Full offline to online round-trip | authenticated provider ACK, remote merge and no duplicate strokes | Provider/service NOT IMPLEMENTED |
| Android Vulkan / iOS Metal native build | installed native UI, Skia3 Graphite, no dual native Skia | Android CI in progress; iOS NOT RUN |

## Skill and owner roster

- [Margelo API design](https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/api-design/SKILL.md): transport-neutral ports, no document duplication, explicit save/ACK lifecycle.
- [Margelo Nitro/C++/Swift/Kotlin](https://github.com/margelo/react-native-skills/tree/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills): independent native rendering, codegen and resource ownership.
- [Callstack RN performance](https://github.com/callstackincubator/agent-skills/blob/59e9d17446a248b21d86f078fcd0bd2d36db1ca4/skills/react-native-best-practices/SKILL.md): no React render on every pen sample and robust native memory.
- [Expo native UI](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-ui/SKILL.md) and [Expo modules](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-module/SKILL.md): native views and storage provider behavior.
- [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md): evidence-backed claims and fail-closed unsupported states.

| Role | Deliverable and next gate | Status |
| --- | --- | --- |
| Document/CRDT lead | One QuickDraw/Yjs BoardDoc across 2D/XR and undo | Existing Moyo architecture; Forge adapter proposed |
| Native persistence lead | MMKV scoped key, migrate legacy unscoped data safely, process-kill test | Scoped adapter implemented; migration NOT RUN |
| Collaboration lead | Authenticated Yjs updates with durable server ACK, reconnect and awareness/presence | NOT RUN |
| Canvas/Skia lead | One `@nitro-forge/board` package, no parallel whiteboard packages | Source consolidation implemented; native test gate pending |
| Ink/geometry lead | Preserve PR #16 pressure and letterboxing in Skia/2D/XR | Pure TS tests |
| Device/QA lead | Offline airplane-mode iPad/Android, Duo, Vision Pro, error and parity | NOT RUN |
| Cross-app lead | Moyo + at least one independent drawing editor use same board with different document adapters | NOT RUN |

**Do not close PR #16 or declare the consolidation complete until its unique geometry/tests are verified in canonical PR #19; no production deployment or npm release is implied.**
