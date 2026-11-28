import { createNitroHost } from "@nitro-forge/ignition";
import { MotionDocument } from "@nitro-forge/motion";

const host = createNitroHost();
const comp = await MotionDocument.open(host, { title: "Intro", width: 320, height: 180, duration_s: 2 });
await comp.addShapeLayer({ kind: "rect", x: 20, y: 20, w: 80, h: 40, fill: [0, 128, 255, 255] }, "Box");

const bytes = await comp.save(); // NFD1 snapshot
await comp.close();

const reopened = await MotionDocument.openSnapshot(host, bytes);
const layers = async () => (await reopened.describe()).data.layers.length;
console.log(await layers()); // 1
await reopened.addShapeLayer({ kind: "ellipse", x: 200, y: 60, w: 60, h: 60, fill: [255, 255, 255, 255] });
await reopened.undo();
console.log(await layers()); // 1
await reopened.redo();
console.log(await layers()); // 2

const frame = await reopened.renderFrame(0.5); // RGBA at t = 0.5 s
console.log(frame.data.width, frame.data.height); // 320 180
await reopened.close();
await host.dispose();
