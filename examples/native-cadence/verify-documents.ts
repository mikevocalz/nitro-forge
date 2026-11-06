import { File, Paths } from "expo-file-system";
import { createPlatformDocuments } from "@nyc-tron/platform-services/documents";
import { createNitroHost, DocumentHandle } from "@nitro-forge/ignition";

export async function verifyPickerCancellation(): Promise<string> {
  const documents = createPlatformDocuments();
  if (!documents.isAvailable) throw new Error("Native document picker is not linked");
  const picked = await documents.pick({ types: [".nfd"], mode: "import" });
  if (picked.length) {
    // This acceptance action is cancellation-only; it never reads picked files.
    for (const item of picked) await documents.releaseAccess(item.uri);
    throw new Error("Cancel the picker for this check; selected files were not read");
  }
  return "Native picker cancellation passed: OS picker returned no documents.";
}

export async function shareTestSnapshot(): Promise<string> {
  const documents = createPlatformDocuments();
  if (!documents.isAvailable) throw new Error("Native sharing module is not linked");
  const host = createNitroHost();
  let bytes: Uint8Array;
  try {
    const document = await DocumentHandle.openInitialized(host, "cadence", d => d.apply("new"));
    await document.apply("setTempo", { bpm: 137 });
    bytes = await document.snapshot();
  } finally { await host.dispose(); }
  const file = new File(Paths.cache, "forge-completion-share-fixture.nfd");
  file.create({ overwrite: true }); file.write(bytes);
  const disk = await file.bytes();
  if (disk.length !== bytes.length || !disk.every((v, i) => v === bytes[i]))
    throw new Error("Share fixture bytes changed on disk");
  // Android resolves when the chooser opens, before a recipient reads the URI.
  // Keep this generated cache file alive after completion/cancellation.
  const completed = await documents.share({ uris: [file.uri], title: "Forge acceptance snapshot" });
  return `Native share fixture prepared: ${bytes.length} NFD1 bytes at 137 BPM. Platform result: ${completed}. Fixture retained in app cache for recipient lifetime.`;
}

/** Import only the generated acceptance fixture; never inspect other files. */
export async function importTestSnapshot(): Promise<string> {
  const documents = createPlatformDocuments();
  if (!documents.isAvailable) throw new Error("Native document picker is not linked");
  const picked = await documents.pick({ types: [".nfd"], mode: "import" });
  if (!picked.length) return "Native fixture import cancelled.";
  const host = createNitroHost();
  try {
    if (picked.length !== 1 || picked[0]!.name !== "forge-completion-share-fixture.nfd")
      throw new Error("Select only forge-completion-share-fixture.nfd; no selected file was read");
    const file = new File(picked[0]!.uri);
    if (file.size > 1024) throw new Error("Unexpected acceptance fixture size");
    const bytes = await file.bytes();
    const document = await DocumentHandle.openInitialized(host, "cadence", d => d.restore(bytes));
    const actual = await document.apply<{ tempo_bpm: number }>("describe");
    if (actual.data.tempo_bpm !== 137) throw new Error("Imported fixture tempo did not survive");
    return `Native fixture import passed: ${bytes.length} NFD1 bytes restored into real Cadence at 137 BPM.`;
  } finally {
    try { for (const item of picked) await documents.releaseAccess(item.uri); }
    finally { await host.dispose(); }
  }
}

const bookmarkFile = () => new File(Paths.document, "forge-completion-fixture-bookmark.json");

/** Retains the generated fixture's access for the explicit relaunch check. */
export async function retainTestBookmark(): Promise<string> {
  const documents = createPlatformDocuments();
  if (!documents.isAvailable) throw new Error("Native document picker is not linked");
  const record = bookmarkFile();
  if (record.exists) throw new Error("Restore the retained test bookmark before creating another");
  const picked = await documents.pick({ types: [".nfd"], mode: "open-in-place" });
  if (!picked.length) return "Native open-in-place fixture check cancelled.";
  let retained = false;
  try {
    if (picked.length !== 1 || picked[0]!.name !== "forge-completion-share-fixture.nfd" || !picked[0]!.bookmark)
      throw new Error("Select only the generated fixture; no selected file was read");
    record.create({ overwrite: false });
    record.write(JSON.stringify({ version: 1, bookmark: picked[0]!.bookmark, uri: picked[0]!.uri, fixture: picked[0]!.name }));
    retained = true;
    return "Native fixture bookmark retained. Restart this app, then Restore test bookmark to verify persisted access.";
  } finally {
    if (!retained) for (const item of picked) await documents.releaseAccess(item.uri);
  }
}

/** Restores only this workflow's private saved bookmark, verifies real engine
 * contents, then releases access and removes its private bookkeeping file. */
export async function restoreTestBookmark(): Promise<string> {
  const documents = createPlatformDocuments();
  if (!documents.isAvailable) throw new Error("Native document picker is not linked");
  const record = bookmarkFile();
  if (!record.exists || record.size > 1024 * 1024) throw new Error("No valid retained fixture bookmark");
  const saved: unknown = JSON.parse(await record.text());
  if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 ||
    !("bookmark" in saved) || typeof saved.bookmark !== "string") throw new Error("Invalid retained bookmark record");
  const access = await documents.restoreAccess(saved.bookmark);
  if (!access) throw new Error("Retained fixture access is no longer available");
  const host = createNitroHost();
  try {
    const file = new File(access.uri);
    if (file.size > 1024) throw new Error("Unexpected retained fixture size");
    const document = await DocumentHandle.openInitialized(host, "cadence", async d => d.restore(await file.bytes()));
    const result = await document.apply<{ tempo_bpm: number }>("describe");
    if (result.data.tempo_bpm !== 137) throw new Error("Retained fixture content changed");
  } finally {
    try { await host.dispose(); } finally { await documents.releaseAccess(access.uri); }
  }
  record.delete();
  return "Native fixture bookmark restore passed: persisted access read the real NFD1 document at 137 BPM; access released and private bookmark removed.";
}

/** Explicit user-initiated export of the current local diagnostic buffer. */
export async function shareDiagnosticTrace(trace: import("@nitro-forge/telemetry").TraceExport): Promise<string> {
  if (trace.consent === "off" || !trace.events.length) throw new Error("Enable local diagnostics and record an action first");
  const documents = createPlatformDocuments();
  if (!documents.isAvailable) throw new Error("Native sharing module is not linked");
  const file = new File(Paths.cache, `forge-diagnostics-${Date.now()}.json`);
  file.create(); file.write(JSON.stringify(trace, null, 2));
  const completed = await documents.share({ uris: [file.uri], title: "Forge local diagnostic trace" });
  return `Diagnostic share sheet result: ${completed}. ${trace.events.length} local events; cache file retained for recipient access.`;
}

/** Deletes only this workflow's retained generated fixture, then checks that
 * a retained OS grant/bookmark cannot masquerade as an existing resource. */
export async function verifyMissingFixture(): Promise<string> {
  const documents = createPlatformDocuments();
  const record = bookmarkFile();
  if (!documents.isAvailable || !record.exists || record.size > 1024 * 1024)
    throw new Error("Retain the generated test fixture first");
  const saved: unknown = JSON.parse(await record.text());
  if (!saved || typeof saved !== "object" || !("bookmark" in saved) || typeof saved.bookmark !== "string")
    throw new Error("Invalid retained fixture bookmark");
  const access = await documents.restoreAccess(saved.bookmark);
  if (!access) throw new Error("Fixture must exist before the missing-resource test");
  try {
    const file = new File(access.uri);
    if (!("fixture" in saved) || saved.fixture !== "forge-completion-share-fixture.nfd" || file.size > 1024)
      throw new Error("Refusing to delete anything except the generated test fixture");
    const host = createNitroHost();
    try {
      const document = await DocumentHandle.openInitialized(host, "cadence", async d => d.restore(await file.bytes()));
      const actual = await document.apply<{ tempo_bpm: number }>("describe");
      if (actual.data.tempo_bpm !== 137) throw new Error("Refusing to delete a non-fixture document");
    } finally { await host.dispose(); }
    file.delete();
    const missing = await documents.restoreAccess(saved.bookmark);
    if (missing) {
      await documents.releaseAccess(missing.uri);
      throw new Error("Deleted provider file still returned restored access");
    }
    return "Native missing fixture passed: deleted generated provider file returned no restored access despite its retained bookmark/grant.";
  } finally {
    await documents.releaseAccess(access.uri);
    record.delete();
  }
}
