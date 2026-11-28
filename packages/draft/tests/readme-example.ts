import { createNitroHost } from "@nitro-forge/ignition";
import { DraftDocument } from "@nitro-forge/draft";

const host = createNitroHost();
const drawing = await DraftDocument.open(host, "mm");
const a = (await drawing.addPoint(0, 0)).data.point_id;
const b = (await drawing.addPoint(100, 0)).data.point_id;
await drawing.addSegment(a, b);

const bytes = await drawing.save(); // NFD1 snapshot
await drawing.close();

const reopened = await DraftDocument.openSnapshot(host, bytes);
const segments = async () => Object.keys((await reopened.describe()).data.segments).length;
console.log(await segments()); // 1
const c = (await reopened.addPoint(100, 50)).data.point_id;
await reopened.addSegment(b, c);
await reopened.undo();
console.log(await segments()); // 1
await reopened.redo();
console.log(await segments()); // 2

const snap = await reopened.querySnap(99.8, 0.1, 1); // tolerance in world units
console.log(snap.data.candidate !== null); // true
await reopened.close();
await host.dispose();
