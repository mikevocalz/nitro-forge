import { createNitroHost, DocumentHandle, EngineError } from "@nitro-forge/ignition";

const host = createNitroHost();
const sheet = await DocumentHandle.openInitialized(host, "tally", (doc) => doc.apply("new", {}));
const cell = await sheet.apply<{ computed: number }>("setCell", { addr: "A1", value: "=6*7" });
console.log(cell.data.computed); // 42

const bytes = await sheet.snapshot(); // NFD1 envelope
await sheet.close();

const reopened = await DocumentHandle.openSnapshot(host, "tally", bytes);
await reopened.apply("setCell", { addr: "A1", value: "1" });
console.log(await reopened.undo()); // true
console.log((await reopened.apply<{ computed: number }>("getCell", { addr: "A1" })).data.computed); // 42
console.log(await reopened.redo()); // true

try {
  await reopened.apply("setCell", { addr: "not a cell", value: "x" });
} catch (error) {
  if (error instanceof EngineError) console.log(error.code); // validation
}
await reopened.close();
await host.dispose();
