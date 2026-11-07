import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { ENGINE_KINDS, type EngineKind } from "@nitro-forge/ignition";
import { validateCheckpoint } from "@nitro-forge/ignition/autosave";
import type { RemoteRevision } from "@nitro-forge/ignition/collaboration";

/** Configuration for startCollaborationServer. The application owns identity
 * verification and document permissions; an authorization callback is required. */
export interface CollaborationServerOptions {
  /** Dedicated SQLite database file. Its parent must already exist. */
  readonly databasePath: string;
  /** Runs before any document data is read or written. Exceptions deny access. */
  readonly authorize: (request: IncomingMessage, documentId: string, operation: "read" | "write") => boolean | Promise<boolean>;
  /** Listen interface. Defaults to loopback; configure a TLS proxy for deployment. */
  readonly host?: string;
  /** Zero allocates a free port. @default 0 */
  readonly port?: number;
  /** Exact browser origins allowed for CORS. Native/CLI requests need no Origin. */
  readonly allowedOrigins?: readonly string[];
  /** Permit cookie credentials for the exact allowed origins. @default false */
  readonly allowCredentials?: boolean;
  /** Per-document NFD1 limit, 9..256 MiB. @default 256 MiB */
  readonly maxBytes?: number;
}
/** A listening service returned by startCollaborationServer. */
export interface CollaborationServer {
  /** Bound interface and allocated port; use localhost when bound to all interfaces. */
  readonly url: string;
  /** Drains accepted HTTP requests, then closes the database. Idempotent. */
  close(): Promise<void>;
}
class HttpError extends Error { constructor(readonly status: number) { super("Collaboration request rejected"); } }
const validId = (id: string) => /^[\w.:-]{1,256}$/.test(id);

/** Starts an authorized binary revision API backed by SQLite WAL with FULL
 * synchronization. A successful write is acknowledged after transaction commit.
 * Revisions are immutable and CAS is atomic across connections/processes using
 * the same SQLite file. Run this Node-only package separately from native apps. */
export async function startCollaborationServer(options: CollaborationServerOptions): Promise<CollaborationServer> {
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  if (!options.databasePath || options.databasePath === ":memory:" || typeof options.authorize !== "function" ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 9 || maxBytes > 256 * 1024 * 1024)
    throw new RangeError("A durable database, authorization policy and bounded snapshot limit are required");
  const origins = new Set(options.allowedOrigins ?? []);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !["https:", "http:"].includes(url.protocol)) throw new RangeError("Invalid allowed origin");
  }
  // DatabaseSync is the Node 24-compatible name (also retained by Node 26).
  const database = new DatabaseSync(options.databasePath, { timeout: 5000 });
  try {
    database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    database.exec(`CREATE TABLE IF NOT EXISTS forge_revisions_v1 (
      document_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0),
      engine TEXT NOT NULL, snapshot BLOB NOT NULL) STRICT;`);
  } catch (error) { database.close(); throw error; }
  const select = database.prepare("SELECT revision, engine, snapshot FROM forge_revisions_v1 WHERE document_id = ?");
  const metadata = database.prepare("SELECT revision, engine, length(snapshot) AS bytes FROM forge_revisions_v1 WHERE document_id = ?");
  const insert = database.prepare("INSERT INTO forge_revisions_v1 VALUES (?, ?, ?, ?)");
  const update = database.prepare("UPDATE forge_revisions_v1 SET revision = ?, engine = ?, snapshot = ? WHERE document_id = ?");
  const read = (id: string): RemoteRevision | undefined => {
    const row = select.get(id); if (!row) return undefined;
    if (typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
        !ENGINE_KINDS.includes(row.engine as EngineKind) || !(row.snapshot instanceof Uint8Array))
      throw new Error("Invalid collaboration database record");
    return { revision: row.revision, kind: row.engine as EngineKind, bytes: row.snapshot.slice() };
  };
  const sendRecord = (response: ServerResponse, status: number, record: RemoteRevision) => {
    response.writeHead(status, { "Content-Type": "application/octet-stream", "Content-Length": record.bytes.length,
      "X-Forge-Revision": record.revision, "X-Forge-Engine": record.kind });
    response.end(record.bytes);
  };
  const pending = new Set<Promise<void>>();
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const task = (async () => {
      const origin = request.headers.origin;
      if (origin) {
        if (!origins.has(origin)) throw new HttpError(403);
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
        if (options.allowCredentials) response.setHeader("Access-Control-Allow-Credentials", "true");
        response.setHeader("Access-Control-Expose-Headers", "X-Forge-Revision, X-Forge-Engine, Content-Length");
      }
      const route = /^\/v1\/documents\/([^/?]+)$/.exec((request.url ?? "").split("?")[0]!);
      let id: string;
      try { id = decodeURIComponent(route?.[1] ?? ""); } catch { throw new HttpError(400); }
      if (!route || !validId(id)) throw new HttpError(400);
      if (request.method === "OPTIONS") {
        if (!origin) throw new HttpError(403);
        response.writeHead(204, { "Access-Control-Allow-Methods": "GET, HEAD, PUT", "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Forge-Base-Revision, X-Forge-Engine" }); response.end(); return;
      }
      if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "PUT") {
        response.setHeader("Allow", "GET, HEAD, PUT, OPTIONS"); throw new HttpError(405);
      }
      let authorized = false;
      let authorizationTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        authorized = await Promise.race([
          Promise.resolve(options.authorize(request, id, request.method === "PUT" ? "write" : "read")),
          new Promise<false>(resolve => { authorizationTimer = setTimeout(() => resolve(false), 10000); }),
        ]);
      }
      catch { /* An unavailable authorization policy never grants access. */ }
      finally { clearTimeout(authorizationTimer); }
      if (authorized !== true) throw new HttpError(403);
      if (request.method === "HEAD") {
        const current = metadata.get(id); if (!current) throw new HttpError(404);
        response.writeHead(200, { "Content-Length": Number(current.bytes), "X-Forge-Revision": Number(current.revision),
          "X-Forge-Engine": String(current.engine) }); response.end(); return;
      }
      if (request.method === "GET") {
        const current = read(id); if (!current) throw new HttpError(404);
        sendRecord(response, 200, current); return;
      }
      const rawRevision = request.headers["x-forge-base-revision"];
      const base = typeof rawRevision === "string" && /^\d+$/.test(rawRevision) ? Number(rawRevision) : NaN;
      const kind = request.headers["x-forge-engine"];
      if (!Number.isSafeInteger(base) || base < 0 || !ENGINE_KINDS.includes(kind as EngineKind) ||
          request.headers["content-type"] !== "application/octet-stream") throw new HttpError(400);
      const bytes = await readBody(request, maxBytes);
      try { validateCheckpoint(bytes); } catch { throw new HttpError(400); }
      database.exec("BEGIN IMMEDIATE");
      let current: RemoteRevision | undefined;
      let accepted = false;
      let next = 0;
      try {
        current = read(id);
        if ((current?.revision ?? 0) === base && (!current || current.kind === kind)) {
          if (base >= Number.MAX_SAFE_INTEGER) throw new HttpError(503);
          next = base + 1;
          if (current) update.run(next, kind as string, bytes, id);
          else insert.run(id, next, kind as string, bytes);
          accepted = true;
        }
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
      if (!accepted) {
        if (!current) throw new HttpError(404);
        sendRecord(response, 409, current); return;
      }
      response.writeHead(204, { "X-Forge-Revision": next }); response.end();
    })().catch(error => {
      if (!response.headersSent) {
        if (!request.complete) { response.setHeader("Connection", "close"); request.resume(); }
        response.writeHead(error instanceof HttpError ? error.status : 500);
      }
      response.end(); // Never echo exception messages, credentials or document contents.
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      server.once("error", fail);
      server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => { server.off("error", fail); resolve(); });
    });
  } catch (error) { database.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); database.close(); throw new Error("Invalid service address"); }
  let closing: Promise<void> | undefined;
  return {
    url: `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`,
    close() {
      if (!closing) closing = new Promise<void>((resolve, reject) => server.close(error => {
        void Promise.allSettled([...pending]).then(() => {
          try { database.close(); if (error) reject(error); else resolve(); } catch (failure) { reject(failure); }
        });
      }));
      return closing;
    },
  };
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
    return Promise.reject(new HttpError(413));
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [], length = 0, settled = false;
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      length += chunk.length;
      if (length > maxBytes) { settled = true; chunks = []; reject(new HttpError(413)); return; }
      chunks.push(chunk);
    });
    request.once("end", () => { if (!settled) { settled = true; resolve(new Uint8Array(Buffer.concat(chunks, length))); chunks = []; } });
    request.once("error", error => { if (!settled) { settled = true; chunks = []; reject(error); } });
    request.once("aborted", () => { if (!settled) { settled = true; chunks = []; reject(new HttpError(400)); } });
  });
}
