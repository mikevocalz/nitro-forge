import { createNitroHost } from "@nitro-forge/ignition";
import { PitchDocument } from "@nitro-forge/pitch";

const host = createNitroHost();
const deck = await PitchDocument.open(host, "Q4 review"); // starts with one slide
const slide = (await deck.addSlide("titleBody")).data.slide_id;
const title = (await deck.addText(slide, 100, 60, 400, 60, "Revenue", 44)).data.object_id;
await deck.addAnimation(slide, title, "fadeIn", 0, 1); // starts at 0 s, lasts 1 s

const bytes = await deck.save(); // NFD1 snapshot
await deck.close();

const reopened = await PitchDocument.openSnapshot(host, bytes);
console.log((await reopened.deck()).data.slide_count); // 2
await reopened.addSlide("title");
await reopened.undo();
console.log((await reopened.deck()).data.slide_count); // 2
await reopened.redo();
console.log((await reopened.deck()).data.slide_count); // 3

const frame = await reopened.slideAt(slide, 2); // the slide 2 s into its timeline
console.log(frame.data.objects.find((o) => o.id === title)?.opacity); // 1
await reopened.close();
await host.dispose();
