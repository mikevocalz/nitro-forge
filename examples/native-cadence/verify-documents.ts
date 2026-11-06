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
