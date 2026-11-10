import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliHost } from "@nitro-forge/ignition/cli";
import { DocumentCollaboration, CollaborationConflict } from "@nitro-forge/ignition/collaboration";
import { createHttpCollaborationTransport, CollaborationTransportError } from "@nitro-forge/ignition/collaboration-http";
import { startCollaborationServer, type CollaborationServer } from "../src/index";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "forge-revisions-")); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "documents.sqlite");
  const start = async () => {
    const server = await startCollaborationServer({ databasePath,
      authorize: (_request, id) => id === "shared:cadence", allowedOrigins: ["https://editor.example"] });
    cleanup.push(() => server.close()); return server;
  };
  return { start, databasePath };
}
async function client(server: CollaborationServer) {
  const host = new CliHost(); cleanup.push(() => host.dispose());
  const transport = createHttpCollaborationTransport({ baseUrl: server.url });
  const document = await DocumentCollaboration.create(host, "cadence", "shared:cadence", transport, [{ op: "new" }]);
  return { document, transport };
}

it("persists a real document over HTTP across service restart and preserves conflicting local history", async () => {
  const f = await fixture(); const first = await f.start(); const a = await client(first);
  await a.document.apply([{ op: "setTempo", payload: { bpm: 137 } }]);
  await a.document.syncNow(); const saved = await a.document.snapshot();
  await first.close(); const second = await f.start(); const b = await client(second);
  await b.document.acceptRemote(); expect(await b.document.snapshot()).toEqual(saved);
  expect(b.document.state).toMatchObject({ revision: 1, dirty: false });
  await b.document.apply([{ op: "setTempo", payload: { bpm: 145 } }]); await b.document.syncNow();
  const c = await client(second); await c.document.acceptRemote();
  await b.document.apply([{ op: "setTempo", payload: { bpm: 150 } }]); await b.document.syncNow();
  await c.document.apply([{ op: "setTempo", payload: { bpm: 160 } }]); const local = await c.document.snapshot();
  await expect(c.document.syncNow()).rejects.toBeInstanceOf(CollaborationConflict);
  expect(await c.document.snapshot()).toEqual(local); expect(await c.document.undo()).toBe(true);
});

it("atomically accepts one of two concurrent CAS writes and returns the durable winner", async () => {
  const f = await fixture(); const server = await f.start(); const { document, transport } = await client(server);
  const bytes = await document.snapshot();
  const results = await Promise.all([transport.compareAndSwap("shared:cadence", 0, { kind: "cadence", bytes }),
    transport.compareAndSwap("shared:cadence", 0, { kind: "cadence", bytes })]);
  expect(results.filter(r => r.accepted)).toHaveLength(1);
  const conflict = results.find(r => !r.accepted)!;
  expect(conflict).toMatchObject({ accepted: false, current: { revision: 1, kind: "cadence" } });
  expect((await transport.read("shared:cadence"))!.bytes).toEqual(bytes);
});

it("authorizes reads/writes before exposing bytes and enforces origin and framing bounds", async () => {
  const f = await fixture(); const server = await f.start(); const { transport } = await client(server);
  await expect(transport.read("private:other")).rejects.toMatchObject({ status: 403 });
  const denied = await fetch(server.url + "/v1/documents/shared%3Acadence", { headers: { Origin: "https://untrusted.example" } });
  expect(denied.status).toBe(403);
  const allowed = await fetch(server.url + "/v1/documents/shared%3Acadence", { method: "OPTIONS", headers: { Origin: "https://editor.example" } });
  expect(allowed.status).toBe(204); expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://editor.example");
  const bad = await fetch(server.url + "/v1/documents/shared%3Acadence", { method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "X-Forge-Base-Revision": "0", "X-Forge-Engine": "cadence" }, body: new Uint8Array([1]) });
  expect(bad.status).toBe(400); expect(await transport.read("shared:cadence")).toBeUndefined();
  await expect(transport.read("../escape")).rejects.toThrow(RangeError);
});

it("rejects oversized uploads without committing and closes idempotently", async () => {
  const f = await fixture(); const server = await startCollaborationServer({ databasePath: f.databasePath, maxBytes: 64, authorize: () => true });
  cleanup.push(() => server.close());
  const response = await fetch(server.url + "/v1/documents/shared%3Acadence", { method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "X-Forge-Base-Revision": "0", "X-Forge-Engine": "cadence" }, body: new Uint8Array(65) });
  expect(response.status).toBe(413);
  expect((await fetch(server.url + "/v1/documents/shared%3Acadence")).status).toBe(404);
  const first = server.close(); expect(server.close()).toBe(first); await first;
});

it("normalizes server rejections without echoing response bodies", async () => {
  const transport = createHttpCollaborationTransport({ baseUrl: "https://provider.example", fetch: async () =>
    new Response("private document detail", { status: 403 }) });
  await expect(transport.read("shared:cadence")).rejects.toBeInstanceOf(CollaborationTransportError);
  await expect(transport.read("shared:cadence")).rejects.not.toThrow("private document detail");
});

it("keeps acknowledged revisions after abrupt process death and serializes CAS across processes", async () => {
  const { spawn } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const { once } = await import("node:events");
  const { fileURLToPath } = await import("node:url");
  const f = await fixture();
  const fixturePath = new URL("./fixtures/server.ts", import.meta.url);
  const loader = createRequire(import.meta.url).resolve("tsx");
  async function child() {
    const process = spawn(globalThis.process.execPath, ["--import", loader, fileURLToPath(fixturePath), f.databasePath],
      { stdio: ["ignore", "pipe", "pipe"] });
    cleanup.push(async () => { if (process.exitCode === null && process.signalCode === null) {
      const exited = once(process, "exit"); process.kill("SIGTERM"); await exited;
    } });
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      process.stdout.setEncoding("utf8");
      process.stdout.on("data", chunk => {
        output += chunk;
        if (output.includes("\n")) { try { resolve(JSON.parse(output.trim()).url); } catch (error) { reject(error); } }
      });
      process.once("error", reject);
      process.once("exit", code => reject(new Error(`Fixture server exited ${code}`)));
    });
    return { process, url };
  }
  const first = await child(); const a = await client({ url: first.url, close: async () => {} });
  await a.document.apply([{ op: "setTempo", payload: { bpm: 151 } }]); await a.document.syncNow();
  const expected = await a.document.snapshot();
  const dead = once(first.process, "exit"); first.process.kill("SIGKILL"); await dead;
  const [second, third] = await Promise.all([child(), child()]);
  const one = createHttpCollaborationTransport({ baseUrl: second.url });
  const two = createHttpCollaborationTransport({ baseUrl: third.url });
  expect((await one.read("shared:cadence"))!.bytes).toEqual(expected);
  const writes = await Promise.all([one.compareAndSwap("shared:cadence", 1, { kind: "cadence", bytes: expected }),
    two.compareAndSwap("shared:cadence", 1, { kind: "cadence", bytes: expected })]);
  expect(writes.filter(r => r.accepted)).toHaveLength(1);
  expect((await two.read("shared:cadence"))!.revision).toBe(2);
});

it("notifies a clean peer using metadata-only polling and drains its owner on close", async () => {
  const f = await fixture(); const server = await f.start();
  const a = await client(server); await a.document.syncNow();
  const b = await client(server); await b.document.acceptRemote();
  let changed!: () => void;
  const updated = new Promise<void>(resolve => { changed = resolve; });
  const requests: string[] = [];
  const transport = createHttpCollaborationTransport({ baseUrl: server.url, fetch: (url, init) => {
    requests.push(init?.method ?? "GET"); return fetch(url, init);
  } });
  const watch = transport.watch({ documentId: "shared:cadence", afterRevision: 1, intervalMs: 250,
    onRevision: async () => { await b.document.syncNow(); changed(); }, onError: error => { throw error; } });
  cleanup.push(() => watch.close());
  await a.document.apply([{ op: "setTempo", payload: { bpm: 172 } }]); await a.document.syncNow();
  await updated; await watch.close();
  expect((await b.document.describe<{ tempo_bpm: number }>()).data.tempo_bpm).toBe(172);
  expect(requests.length).toBeGreaterThan(0); expect(requests.every(m => m === "HEAD")).toBe(true);
});

it("bounds client deadlines and aborts watch I/O without reporting disposal as failure", async () => {
  const waiting: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
  });
  const transport = createHttpCollaborationTransport({ baseUrl: "https://provider.example", timeoutMs: 5, fetch: waiting });
  await expect(transport.read("shared:cadence")).rejects.toMatchObject({ name: "AbortError" });
  let failures = 0;
  const watch = transport.watch({ documentId: "shared:cadence", afterRevision: 0,
    onRevision: () => {}, onError: () => { failures++; return "stop"; } });
  await watch.close(); expect(failures).toBe(0);
  expect(() => createHttpCollaborationTransport({ baseUrl: "http://provider.example" })).toThrow("HTTPS");
});

it("fails closed when the authorization provider throws", async () => {
  const f = await fixture();
  const server = await startCollaborationServer({ databasePath: f.databasePath, authorize: () => { throw new Error("private policy detail"); } });
  cleanup.push(() => server.close());
  const response = await fetch(server.url + "/v1/documents/shared%3Acadence");
  expect(response.status).toBe(403); expect(await response.text()).toBe("");
});
