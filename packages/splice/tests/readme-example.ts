import { createNitroHost } from "@nitro-forge/ignition";
import { SpliceDocument } from "@nitro-forge/splice";

const host = createNitroHost();
const edit = await SpliceDocument.open(host, 30); // 30 fps
const source = (await edit.addSource(10, "take1.mp4")).data.source_id; // 10 s of media
const track = (await edit.addTrack("video")).data.track_id;
const clip = (await edit.addClip({ track, source, in_s: 0, out_s: 8 })).data.clip_id;
const { right_id: secondHalf } = (await edit.splitClip(clip, 4)).data;
console.log((await edit.duration()).data.seconds); // 8

const bytes = await edit.save(); // NFD1 snapshot
await edit.close();

const reopened = await SpliceDocument.openSnapshot(host, bytes);
await reopened.setSpeed(secondHalf, 2); // the second half now plays in 2 s
console.log((await reopened.duration()).data.seconds); // 6
await reopened.undo();
console.log((await reopened.duration()).data.seconds); // 8
await reopened.redo();
console.log((await reopened.duration()).data.seconds); // 6
await reopened.close();
await host.dispose();
