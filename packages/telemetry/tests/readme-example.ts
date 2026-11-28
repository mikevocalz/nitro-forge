import { createNitroHost } from "@nitro-forge/ignition";
import { PrismDocument } from "@nitro-forge/prism";
import { createTelemetry, instrumentHost } from "@nitro-forge/telemetry";

const telemetry = createTelemetry({ consent: "local" }); // keep events on the device
const host = instrumentHost(createNitroHost(), telemetry);

const image = await PrismDocument.open(host, 16, 16);
const layer = (await image.addRasterLayer("Private name")).data.layer_id;
await image.fillLayer(layer, [0, 0, 255, 255]);
const bytes = await image.save(); // NFD1 snapshot
await image.close();

const reopened = await PrismDocument.openSnapshot(host, bytes);
await reopened.setLayerOpacity(layer, 0.25);
await reopened.undo();
await reopened.redo();
await reopened.close();
await host.dispose();

const trace = telemetry.exportTrace(); // for a bug report
const spans = trace.events.filter((e) => e.type === "span").map((e) => e.name);
console.log(spans.includes("engine.undo") && spans.includes("engine.redo")); // true
console.log(JSON.stringify(trace).includes("Private name")); // false
