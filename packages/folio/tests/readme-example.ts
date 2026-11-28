import { createNitroHost } from "@nitro-forge/ignition";
import { FolioDocument } from "@nitro-forge/folio";

const host = createNitroHost();
const pdf = await FolioDocument.create(host, 2); // two blank letter pages
await pdf.addAnnotation(0, [72, 700, 200, 20], "Check this figure", "Text");

const bytes = await pdf.save(); // NFD1 snapshot
await pdf.close();

const reopened = await FolioDocument.openSnapshot(host, bytes);
const notes = async () => (await reopened.listAnnotations(0)).data.annots.length;
console.log(await notes()); // 1
await reopened.addAnnotation(0, [72, 650, 200, 20], "Second note", "Text");
await reopened.undo();
console.log(await notes()); // 1
await reopened.redo();
console.log(await notes()); // 2

const file = await reopened.savePdf(); // real PDF bytes
console.log(new TextDecoder().decode(file.bytes.subarray(0, 5))); // %PDF-
await reopened.close();
await host.dispose();
