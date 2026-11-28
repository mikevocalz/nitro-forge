import { createNitroHost } from "@nitro-forge/ignition";
import { QuillDocument } from "@nitro-forge/quill";

const host = createNitroHost();
const doc = await QuillDocument.open(host);
await doc.insertText({ block: 0, offset: 0 }, "Hello world");
await doc.applyStyle({ block: 0, offset: 0 }, { block: 0, offset: 5 }, { bold: true });

const bytes = await doc.save(); // NFD1 snapshot
await doc.close();

const reopened = await QuillDocument.openSnapshot(host, bytes);
const text = async () => (await reopened.text()).data.text;
console.log(await text()); // Hello world
await reopened.insertText({ block: 0, offset: 11 }, "!");
await reopened.undo();
console.log(await text()); // Hello world
await reopened.redo();
console.log(await text()); // Hello world!

const docx = await reopened.exportDocx(); // .docx bytes
const imported = await QuillDocument.openDocx(host, docx);
console.log((await imported.text()).data.text); // Hello world!
await imported.close();
await reopened.close();
await host.dispose();
