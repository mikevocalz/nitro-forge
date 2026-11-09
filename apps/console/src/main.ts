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
import { PhotoDocument } from "@nitro-forge/photo";
import { MotionDocument } from "@nitro-forge/motion";
import { DesignDocument } from "@nitro-forge/design";
import { DraftDocument } from "@nitro-forge/draft";
import { SceneDocument } from "@nitro-forge/scene";

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

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

  console.log("\n▸ Photo — catalog & develop");
  {
    const doc = await PhotoDocument.open(host);
    const added = (
      await doc.addOriginal({
        sha256: "d".repeat(64),
        asset_ref: "retained:demo-raw",
        byte_length: 4096,
        camera_make: "Pentax",
        camera_model: "K-7",
      })
    ).data;
    await doc.setRating(added.original_id, 4);
    const version = (
      await doc.createVersion(added.original_id, "edit-1")
    ).data.version_id;
    const develop = {
      schema: 1 as const,
      exposure_ev: 1,
      contrast: 1,
      rgb_gain: [1, 1, 1] as [number, number, number],
    };
    await doc.setDevelop(version, develop);
    const prev = await doc.processPreview(
      {
        version_id: version,
        original_id: added.original_id,
        original_sha256: "d".repeat(64),
        expected_develop: develop,
        width: 1,
        height: 1,
        format: "rgba8-straight-srgb",
      },
      new Uint8Array([128, 64, 32, 99]),
    );
    ok("develop preview lifts exposure", prev.pixels[0] === 176, `${prev.pixels[0]}`);
    await doc.undo();
    ok(
      "undo restores identity develop",
      (await doc.readDevelop(version)).data.develop.exposure_ev === 0,
    );
    await doc.redo();
    const snap = await doc.save();
    await doc.close();
    const re = await PhotoDocument.openSnapshot(host, snap);
    const read = await re.readOriginal(added.original_id);
    ok(
      "reopen keeps rating + versions",
      read.data.original.rating === 4 && read.data.versions.length === 2,
      `rating ${read.data.original.rating}, ${read.data.versions.length} versions`,
    );
    await re.close();
  }

  console.log("\n▸ Motion — composition");
  {
    const doc = await MotionDocument.open(host, {
      width: 8,
      height: 1,
      duration_s: 1,
      frame_rate: { num: 24, den: 1 },
    });
    const layer = (
      await doc.addShapeLayer(
        { kind: "rect", x: 0, y: 0, w: 1, h: 1, fill: [255, 0, 0, 255] },
        "mover",
      )
    ).data.layer_id;
    await doc.setPropertyKeys(layer, "tx", [
      { time: 0, value: 0, interpolation: "linear", in_handle: null, out_handle: null },
      { time: 1, value: 7, interpolation: "linear", in_handle: null, out_handle: null },
    ]);
    const mid = (await doc.evaluate(0.5)).data.layers.find((l) => l.id === layer)!;
    ok("linear tx midpoint", Math.abs(mid.transform.tx - 3.5) < 1e-6, `${mid.transform.tx}`);
    const frame = await doc.renderFrame(1);
    ok(
      "rendered RGBA frame",
      frame.data.width === 8 && typeof frame.data.pixels_b64 === "string",
    );
    await doc.undo();
    ok(
      "undo clears the tx curve",
      (await doc.describe()).data.layers.find((l) => l.id === layer)!.curves.length === 0,
    );
    await doc.redo();
    const snap = await doc.save();
    await doc.close();
    const re = await MotionDocument.openSnapshot(host, snap);
    ok("reopen keeps layer", (await re.describe()).data.layers.length === 1);
    await re.close();
  }

  console.log("\n▸ Design — interface document");
  {
    const doc = await DesignDocument.open(host, {
      title: "Demo Screen",
      width: 20,
      height: 10,
    });
    const frame = (
      await doc.addFrame(1, { x: 0, y: 0, width: 10, height: 10, name: "Card" })
    ).data.node_id;
    await doc.addShape(frame, "rect", {
      x: 1,
      y: 1,
      width: 4,
      height: 4,
      fill: [36, 145, 132, 255],
    });
    const text = (await doc.addText(1, { content: "Hello", fill: [0, 0, 0, 255] })).data.node_id;
    const layout = await doc.evaluateLayout();
    ok("evaluated layout boxes", layout.data.boxes.length >= 3, `${layout.data.boxes.length}`);
    await doc.undo();
    ok(
      "undo removes the text node",
      !((await doc.describe()).data.nodes as Record<string, unknown>)[String(text)],
    );
    await doc.redo();
    const snap = await doc.save();
    await doc.close();
    const re = await DesignDocument.openSnapshot(host, snap);
    const nodes = Object.keys((await re.describe()).data.nodes).length;
    ok("reopen keeps nodes", nodes === 4, `${nodes}`);
    await re.close();
  }

  console.log("\n▸ Draft — CAD drawing");
  {
    const doc = await DraftDocument.open(host, "mm");
    const a = (await doc.addPoint(0, 0)).data.point_id;
    const b = (await doc.addPoint(10, 0)).data.point_id;
    const c = (await doc.addPoint(10, 10)).data.point_id;
    const d = (await doc.addPoint(0, 10)).data.point_id;
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ])
      await doc.addSegment(p, q);
    const profiles = await doc.findProfiles();
    ok(
      "closed profile area 100",
      profiles.data.profiles[0]?.area === 100,
      `${profiles.data.profiles[0]?.area}`,
    );
    const frame = await doc.renderFrame({
      width: 10,
      height: 10,
      origin_x: 0,
      origin_y: 0,
      scale: 1,
    });
    ok("rendered draft pixels", typeof frame.data.pixels_b64 === "string");
    await doc.undo();
    ok(
      "undo drops a segment",
      Object.keys((await doc.describe()).data.segments).length === 3,
    );
    await doc.redo();
    const snap = await doc.save();
    await doc.close();
    const re = await DraftDocument.openSnapshot(host, snap);
    ok(
      "reopen keeps geometry",
      Object.keys((await re.describe()).data.segments).length === 4,
    );
    await re.close();
  }

  console.log("\n▸ Scene — 3D scene graph (render stays host-side)");
  {
    const doc = await SceneDocument.open(host, "demo-scene");
    const mat = (await doc.addMaterial({ name: "paint", color: "#3366CC" }))
      .data.material_id;
    const mesh = (
      await doc.addMeshPrimitive({ kind: "box", size: [2, 2, 2], material: mat })
    ).data.mesh_id;
    const cam = (
      await doc.addNode({
        kind: "camera",
        name: "cam",
        camera: { type: "perspective", fov_y_degrees: 60 },
        translation: [0, 0, 5],
      })
    ).data.node_id;
    await doc.addNode({
      kind: "light",
      light: { type: "ambient", color: [1, 1, 1], intensity: 0.6 },
    });
    const box = (await doc.addNode({ kind: "mesh", name: "box", mesh })).data
      .node_id;
    const bounds = (await doc.bounds()).data.bounds;
    ok(
      "world bounds span the box",
      bounds !== null && bounds.min[0] === -1 && bounds.max[0] === 1,
      JSON.stringify(bounds),
    );
    const pick = await doc.pick([0, 0, 5], [0, 0, -1]);
    ok("pick hits the box", pick.data.hit?.node_id === box);
    // renderFrame emits the canonical scene-render description; pixels are
    // the host service's job, not the engine's.
    const frame = (
      await doc.renderFrame({ width: 16, height: 16, camera_node: cam })
    ).data as { meshes: unknown[]; camera: { type: string } };
    ok(
      "renderFrame emits scene description",
      frame.meshes.length === 1 && frame.camera.type === "perspective",
    );
    const dup = (await doc.duplicateNode(box)).data;
    ok("duplicate subtree", dup.count === 1 && dup.node_id !== box);
    await doc.undo();
    ok(
      "undo drops the duplicate",
      Object.keys((await doc.describe()).data.nodes).length === 3,
    );
    const snap = await doc.save();
    await doc.close();
    const re = await SceneDocument.openSnapshot(host, snap);
    ok(
      "reopen keeps nodes",
      Object.keys((await re.describe()).data.nodes).length === 3,
    );
    await re.close();
  }

  await host.dispose();
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.\n`);
    process.exit(1);
  }
  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error("console failed:", e);
  process.exit(1);
});
