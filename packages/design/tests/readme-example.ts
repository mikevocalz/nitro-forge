import { createNitroHost } from "@nitro-forge/ignition";
import { DesignDocument } from "@nitro-forge/design";

const ROOT = 1; // the root canvas frame

const host = createNitroHost();
const design = await DesignDocument.open(host, { title: "Card", width: 400, height: 300 });
const card = (await design.addFrame(ROOT, { name: "Card", width: 240, height: 120 })).data.node_id;
await design.addShape(card, "rect", { name: "Badge", width: 40, height: 40, fill: [255, 0, 0, 255] });

const bytes = await design.save(); // NFD1 snapshot
await design.close();

const reopened = await DesignDocument.openSnapshot(host, bytes);
const count = async () => Object.keys((await reopened.describe()).data.nodes).length;
console.log(await count()); // 3
await reopened.addShape(card, "ellipse", { width: 20, height: 20 });
await reopened.undo();
console.log(await count()); // 3
await reopened.redo();
console.log(await count()); // 4

const frame = await reopened.renderFrame(); // RGBA of the root canvas
console.log(frame.data.width, frame.data.height); // 400 300
await reopened.close();
await host.dispose();
