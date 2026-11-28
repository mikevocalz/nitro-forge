import { createNitroHost } from "@nitro-forge/ignition";
import { TallyDocument } from "@nitro-forge/tally";

const host = createNitroHost();
const sheet = await TallyDocument.open(host);
await sheet.setCell("A1", "10");
await sheet.setCell("A2", "32");
const total = await sheet.setCell("A3", "=SUM(A1:A2)");
console.log(total.data.computed); // 42

const bytes = await sheet.save(); // NFD1 snapshot
await sheet.close();

const reopened = await TallyDocument.openSnapshot(host, bytes);
await reopened.setCell("A1", "20");
console.log((await reopened.getCell("A3")).data.computed); // 52
await reopened.undo();
console.log((await reopened.getCell("A3")).data.computed); // 42
await reopened.redo();
console.log((await reopened.getCell("A3")).data.computed); // 52
await reopened.close();
await host.dispose();
