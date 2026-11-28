import { createNitroHost } from "@nitro-forge/ignition";
import { PrismDocument } from "@nitro-forge/prism";

type Layers = { layers: { id: number; opacity: number }[] };

const host = createNitroHost();
const image = await PrismDocument.open(host, 64, 64);
const layer = (await image.addRasterLayer("Paint")).data.layer_id;
await image.fillLayer(layer, [255, 0, 0, 255]);
await image.setLayerOpacity(layer, 0.5);

const bytes = await image.save(); // NFD1 snapshot
await image.close();

const reopened = await PrismDocument.openSnapshot(host, bytes);
const opacity = async () =>
  (await reopened.describe<Layers>()).data.layers.find((l) => l.id === layer)?.opacity;
console.log(await opacity()); // 0.5
await reopened.setLayerOpacity(layer, 1);
await reopened.undo();
console.log(await opacity()); // 0.5
await reopened.redo();
console.log(await opacity()); // 1

const flat = await reopened.flatten(); // composited RGBA as base64
console.log(flat.data.width, flat.data.height); // 64 64
await reopened.close();
await host.dispose();
