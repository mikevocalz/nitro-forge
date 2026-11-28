import { createNitroHost } from "@nitro-forge/ignition";
import { CadenceDocument } from "@nitro-forge/cadence";

const host = createNitroHost();
const song = await CadenceDocument.open(host, 120); // 120 BPM, 960 ticks per beat
const track = (await song.addTrack("midi", "Keys")).data.track_id;
const clip = (await song.addClip(track, 0, 960)).data.clip_id;
await song.addNote(clip, 69, 0, 960); // A4 for one beat

const bytes = await song.save(); // NFD1 snapshot
await song.close();

const reopened = await CadenceDocument.openSnapshot(host, bytes);
console.log((await reopened.project()).data.track_count); // 1
await reopened.setTempo(90);
await reopened.undo();
console.log((await reopened.project()).data.tempo_bpm); // 120
await reopened.redo();
console.log((await reopened.project()).data.tempo_bpm); // 90

const { frames, samples } = await reopened.render(0, 960, 48000); // stereo f32
console.log(samples.length === frames * 2); // true
await reopened.close();
await host.dispose();
