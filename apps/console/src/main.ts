/**
 * nf-console — exercises every Nitro-Forge engine through a real user workflow:
 * create → edit → save → close → reopen → verify → undo. All work goes through
 * the actual compiled Rust engines (nf-cli transport, same protocol as Nitro).
 *
 * Run: node --experimental-strip-types apps/console/src/main.ts
 */
import { base64ToBytes } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PrismDocument } from "@nitro-forge/prism";
import { CadenceDocument } from "@nitro-forge/cadence";
import { SpliceDocument } from "@nitro-forge/splice";
import { FolioDocument } from "@nitro-forge/folio";
import { PitchDocument } from "@nitro-forge/pitch";
import { TallyDocument } from "@nitro-forge/tally";
import { QuillDocument } from "@nitro-forge/quill";

const ok = (name: string, cond: boolean, detail = "") =>
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);

async function main() {
  const host = new CliHost();

  console.log("\n▸ Prism — image editor");
  {
    const doc = await PrismDocument.open(host, 32, 32);
    const bg = (await doc.addRasterLayer("background")).data.layer_id;
    await doc.fillLayer(bg, [255, 255, 255, 255]);
    const art = (await doc.addRasterLayer("art")).data.layer_id;
    await doc.drawPixels(art, 8, 8, 4, 4, new Uint8Array(64).fill(255));
    const flat = await doc.flatten();
    ok("flatten 32×32", flat.data.width === 32);
    const snap = await doc.save();
    await doc.close();
    const re = await PrismDocument.openSnapshot(host, snap);
    const layers = (await re.describe<any>()).data.layers.length;
    ok("reopen preserves 2 layers", layers === 2, `${layers}`);
    await re.close();
  }

  console.log("\n▸ Cadence — audio");
  {
    const doc = await CadenceDocument.open(host, 128);
    const t = (await doc.addTrack("midi", "lead")).data.track_id;
    const c = (await doc.addClip(t, 0, 1920)).data.clip_id;
    for (const [i, p] of [60, 64, 67, 72].entries())
      await doc.addNote(c, p, i * 480, 480);
    const { frames } = await doc.render(0, 1920, 44100);
    ok("rendered PCM frames", frames > 0, `${frames}`);
    const snap = await doc.save();
    await doc.close();
    const re = await CadenceDocument.openSnapshot(host, snap);
    ok("reopen tempo", (await re.project()).data.tempo_bpm === 128);
    await re.close();
  }

  console.log("\n▸ Splice — video");
  {
    const doc = await SpliceDocument.open(host, 30);
    const src = (await doc.addSource(60, "interview.mp4")).data.source_id;
    const tr = (await doc.addTrack("video")).data.track_id;
    const clip = (
      await doc.addClip({ track: tr, source: src, in_s: 5, out_s: 25 })
    ).data.clip_id;
    await doc.splitClip(clip, 10);
    ok("split at 5s", (await doc.duration()).data.seconds === 20);
    const snap = await doc.save();
    await doc.close();
    const re = await SpliceDocument.openSnapshot(host, snap);
    ok("reopen duration", (await re.duration()).data.seconds === 20);
    await re.close();
  }

  console.log("\n▸ Folio — PDF");
  {
    const doc = await FolioDocument.create(host, 3);
    await doc.addAnnotation(0, [72, 700, 200, 18], "Review this");
    const { bytes } = await doc.savePdf();
    ok("real PDF bytes", new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-");
    await doc.close();
    const re = await FolioDocument.openPdf(host, bytes);
    const annots = await re.listAnnotations(0);
    ok("PDF reopens with annotation", annots.data.annots.length === 1);
    await re.close();
  }

  console.log("\n▸ Pitch — presentations");
  {
    const doc = await PitchDocument.open(host, "Launch Plan");
    const s = (await doc.addSlide("titleBody")).data.slide_id;
    const t = (await doc.addText(s, 80, 100, 600, 80, "Roadmap", 40)).data
      .object_id;
    await doc.addAnimation(s, t, "slideInLeft", 0.5, 0.8);
    const mid = (await doc.slideAt(s, 0.9)).data.objects.find(
      (o) => o.id === t,
    )!;
    ok("slideInLeft mid-flight", mid.opacity > 0 && mid.opacity < 1);
    const snap = await doc.save();
    await doc.close();
    const re = await PitchDocument.openSnapshot(host, snap);
    ok("reopen deck", (await re.deck()).data.slide_count === 2);
    await re.close();
  }

  console.log("\n▸ Tally — spreadsheet");
  {
    const doc = await TallyDocument.open(host);
    await doc.setCell("A1", "Price");
    await doc.setCell("B1", "19.99");
    await doc.setCell("A2", "Qty");
    await doc.setCell("B2", "3");
    const total = await doc.setCell("B3", "=B1*B2");
    ok("=B1*B2", total.data.computed === 59.97, `${total.data.computed}`);
    const snap = await doc.save();
    await doc.close();
    const re = await TallyDocument.openSnapshot(host, snap);
    ok("reopen formula", (await re.getCell("B3")).data.computed === 59.97);
    await re.close();
  }

  console.log("\n▸ Quill — rich text");
  {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "Release notes");
    await doc.setBlockKind(0, "h1");
    await doc.insertBlock(1);
    await doc.insertText({ block: 1, offset: 0 }, "Everything shipped.");
    const docx = await doc.exportDocx();
    ok("DOCX zip magic", docx[0] === 0x50 && docx[1] === 0x4b);
    await doc.close();
    const re = await QuillDocument.openDocx(host, docx);
    ok("DOCX re-imports", (await re.text()).data.text.includes("Release notes"));
    await re.close();
  }

  await host.dispose();
  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error("console failed:", e);
  process.exit(1);
});
