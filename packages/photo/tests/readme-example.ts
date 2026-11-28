import { createNitroHost } from "@nitro-forge/ignition";
import { PhotoDocument } from "@nitro-forge/photo";

const host = createNitroHost();
const catalog = await PhotoDocument.open(host);
const { original_id } = (
  await catalog.addOriginal({
    sha256: "a".repeat(64), // the host computes and vouches for the file hash
    asset_ref: "library:IMG_0001", // the host's own id: letters, digits and ._:-
    byte_length: 24_000_000,
    camera_make: "Example",
    camera_model: "One",
  })
).data;
await catalog.setRating(original_id, 3);

const bytes = await catalog.save(); // NFD1 snapshot
await catalog.close();

const reopened = await PhotoDocument.openSnapshot(host, bytes);
const rating = async () => (await reopened.readOriginal(original_id)).data.original.rating;
console.log(await rating()); // 3
await reopened.setRating(original_id, 5);
await reopened.undo();
console.log(await rating()); // 3
await reopened.redo();
console.log(await rating()); // 5
await reopened.close();
await host.dispose();
