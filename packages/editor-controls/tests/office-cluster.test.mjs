import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { splitSentences, readAloudSentences, wordSpans, clampRate, stepRate, formatRate, readAloudPosition, sentenceIndexAtBlock, tidySpoken, READ_ALOUD_MAX_SENTENCE } from "../src/office/read-aloud-model.ts";
import { findInPageText, insertPageHits, stepHit, searchPageOrder, groupHitsByPage, searchSummary, PDF_SEARCH_MAX_HITS } from "../src/pdf/search-model.ts";
import { orderTools, toolForKey, toolForSubtype } from "../src/pdf/annotation-model.ts";
import { groupThreads, threadCounts, resolveReply, threadLabel } from "../src/pdf/comments-model.ts";
import { ribbonStateFor, nextToggle, applyTextCase, stepFontSize, ribbonShortcut, sharedValue } from "../src/document/ribbon-model.ts";
import { listMarker, listMarkers, listPreviewMarkers, LIST_PREVIEW_MARKER_MAX, BULLETS_NUMBERING_CAPABILITIES, canIndent, canOutdent, shiftLevels, defaultLevelFormats } from "../src/document/list-model.ts";
import { visibleOutline, headingAtBlock, rowForHeading, headingsByPage } from "../src/document/outline-model.ts";
import { moveId, moveBlock, planMoves, nextSelection, gridColumns, gridMove, rgbaCss, slideTitle, slideLabel } from "../src/slides/slide-model.ts";
import { snapRect, resizeFromCorner, nudge, stepRotation, hitTest, fitScale, objectLabel } from "../src/slides/canvas-model.ts";
import { playOrder, timelineEnd, parseSeconds, effectLabel, SLIDE_ANIMATION_EFFECTS } from "../src/slides/animation-model.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slice = (text, [a, b]) => [...text].slice(a, b).join("");

test("H-21/K-18 sentences: abbreviations, initials, closing quotes and long runs", () => {
  const t = "Dr. Smith met J. Jones et al. at noon. \"Is it done?\" she asked. Fine!";
  assert.deepEqual(splitSentences(t).map(s => slice(t, s)),
    ["Dr. Smith met J. Jones et al. at noon.", "\"Is it done?\"", "she asked.", "Fine!"]);
  assert.deepEqual(splitSentences("3.14 is pi. Yes").map(s => slice("3.14 is pi. Yes", s)), ["3.14 is pi.", "Yes"]);
  const long = ("word ".repeat(200)).trim();
  const parts = splitSentences(long);
  assert.ok(parts.length >= 2 && parts.every(([a, b]) => b - a < READ_ALOUD_MAX_SENTENCE + "word ".length));
  assert.equal(tidySpoken("A  ( ) b ."), "A b.");
});

test("H-21 queue maps each sentence back to its block and char range", () => {
  const blocks = [{ block: 0, text: "Héllo wörld. Second one." }, { block: 2, text: "   " }, { block: 3, text: "Ünïcode 🎉 works! ..." }];
  const q = readAloudSentences(blocks);
  assert.deepEqual(q.map(s => [s.block, s.text]), [[0, "Héllo wörld."], [0, "Second one."], [3, "Ünïcode 🎉 works!"]]);
  for (const s of q) assert.equal(slice(blocks.find(b => b.block === s.block).text, [s.start, s.end]), s.text);
  assert.equal(sentenceIndexAtBlock(q, 1), 2);
  assert.equal(sentenceIndexAtBlock(q, 9), 2);
  assert.equal(readAloudPosition(5, 3), "Sentence 3 of 3");
  assert.equal(readAloudPosition(0, 0), "Nothing to read");
});

test("read-aloud words skip punctuation-only runs; speed stays in 0.5–3", () => {
  const text = "Wait — what, really?";
  assert.deepEqual(wordSpans(text).map(s => slice(text, s)), ["Wait", "what,", "really?"]);
  assert.equal(clampRate(9), 3); assert.equal(clampRate(0.1), 0.5); assert.equal(clampRate(NaN), 1);
  assert.equal(stepRate(1, 1), 1.25); assert.equal(stepRate(1, -1), 0.75);
  assert.equal(stepRate(3, 1), 3); assert.equal(stepRate(0.5, -1), 0.5);
  assert.equal(formatRate(1.25), "1.25×");
});

test("K-04 search: case, whole words, snippets, page order and wrap", () => {
  const text = "The cat sat. Concatenate CAT\nlines.";
  assert.deepEqual(findInPageText(0, text, "cat").map(h => [h.start, h.end]), [[4, 7], [16, 19], [25, 28]]);
  assert.equal(findInPageText(0, text, "cat", { caseSensitive: true }).length, 2);
  assert.deepEqual(findInPageText(0, text, "cat", { wholeWords: true }).map(h => h.start), [4, 25]);
  const hit = findInPageText(0, text, "cat", { wholeWords: true })[1];
  assert.equal(hit.match, "CAT"); assert.ok(!hit.after.includes("\n"));
  assert.deepEqual(findInPageText(0, text, "  "), []);
  assert.deepEqual(searchPageOrder(5, 3), [3, 4, 0, 1, 2]);
  assert.deepEqual(searchPageOrder(3, -1), [2, 0, 1]);
  // Searching from page 2: page 2's hits come first and stay current while earlier pages are inserted before them.
  let s = { hits: [], current: -1 };
  for (const page of [2, 0, 1]) s = insertPageHits(s.hits, findInPageText(page, "cat cat", "cat"), s.current);
  assert.deepEqual(s.hits.map(h => h.page), [0, 0, 1, 1, 2, 2]);
  assert.equal(s.current, 4);
  assert.equal(stepHit(5, 6, true), 0); assert.equal(stepHit(0, 6, false), 5); assert.equal(stepHit(-1, 6, false), 0); assert.equal(stepHit(0, 0, true), -1);
  assert.deepEqual(groupHitsByPage(s.hits).map(g => [g.page, g.items.map(i => i.index)]), [[0, [0, 1]], [1, [2, 3]], [2, [4, 5]]]);
  const many = Array.from({ length: PDF_SEARCH_MAX_HITS + 5 }, (_, i) => ({ page: 0, start: i, end: i + 1, before: "", match: "x", after: "" }));
  const capped = insertPageHits([], many, -1);
  assert.equal(capped.hits.length, PDF_SEARCH_MAX_HITS); assert.equal(capped.capped, true);
  assert.equal(searchSummary(3, 2, 9, true), "3 matches so far, 2 of 9 pages searched");
  assert.equal(searchSummary(1, 9, 9, false), "1 match");
});

test("K-06 tools: order, shortcuts and PDF subtypes", () => {
  assert.deepEqual(orderTools(["highlight", "select", "note", "highlight"]), ["select", "note", "highlight"]);
  assert.throws(() => orderTools(["laser"]), RangeError);
  assert.equal(toolForKey("H", ["select", "highlight"]), "highlight");
  assert.equal(toolForKey("u", ["select", "highlight"]), undefined);
  assert.equal(toolForKey("Escape", ["note"]), undefined);
  assert.equal(toolForSubtype("highlight"), "highlight");
  assert.equal(toolForSubtype("StrikeOut"), "strike");
  assert.equal(toolForSubtype("Popup"), undefined);
});

test("K-07 threads: page grouping, filters, blank replies, labels", () => {
  const threads = [
    { id: "a", page: 3, body: "Fix", replies: [], resolved: false },
    { id: "b", page: 0, body: "Typo", author: "Ana", replies: [{ id: "b1", body: "Done" }], resolved: true },
    { id: "c", page: 3, body: "Why", replies: [] },
  ];
  assert.deepEqual(groupThreads(threads).map(g => [g.page, g.threads.map(t => t.id)]), [[0, ["b"]], [3, ["a", "c"]]]);
  assert.deepEqual(groupThreads(threads, "open").flatMap(g => g.threads.map(t => t.id)), ["a", "c"]);
  assert.deepEqual(groupThreads(threads, "resolved").flatMap(g => g.threads.map(t => t.id)), ["b"]);
  assert.deepEqual(threadCounts(threads), { open: 2, resolved: 1, all: 3 });
  assert.throws(() => groupThreads([{ id: "x", page: -1, body: "", replies: [] }]), RangeError);
  assert.equal(resolveReply("  "), undefined); assert.equal(resolveReply(" ok "), "ok");
  assert.equal(threadLabel(threads[1]), "Page 1, Ana: Typo, 1 reply, resolved");
});

test("H-03 ribbon: mixed state, toggles, case, size ladder, shortcuts", () => {
  const s = ribbonStateFor([{ bold: true, color: "#ff0000" }, { bold: false, italic: true, color: "#ff0000" }]);
  assert.equal(s.bold, "mixed"); assert.equal(s.italic, "mixed"); assert.equal(s.underline, false); assert.equal(s.color, "#ff0000");
  assert.equal(ribbonStateFor([]).bold, false);
  assert.equal(sharedValue([1, 2]), "mixed"); assert.equal(sharedValue([]), undefined);
  assert.equal(nextToggle("mixed"), true); assert.equal(nextToggle(true), false); assert.equal(nextToggle(false), true);
  assert.equal(applyTextCase("hello world. new one", "sentence"), "Hello world. New one");
  assert.equal(applyTextCase("o'neil and mcDONALD", "capitalize"), "O'neil And Mcdonald");
  assert.equal(applyTextCase("Straße", "upper"), "STRASSE");
  assert.equal(stepFontSize(11, 1), 12); assert.equal(stepFontSize(11, -1), 10.5); assert.equal(stepFontSize(96, 1), 100); assert.equal(stepFontSize(8, -1), 7);
  assert.deepEqual(ribbonShortcut("B", true, false), { toggle: "bold" });
  assert.deepEqual(ribbonShortcut("x", true, true), { toggle: "strike" });
  assert.equal(ribbonShortcut("b", false, false), undefined);
});

test("H-07 lists: markers, restart under shallower items, nesting policy", () => {
  assert.equal(listMarker("lowerRoman", 14), "xiv."); assert.equal(listMarker("upperLetter", 28), "BB."); assert.equal(listMarker("bullet", 1, 1), "◦");
  assert.throws(() => listMarker("decimal", 0), RangeError);
  const items = [{ level: 0 }, { level: 1 }, { level: 1 }, { level: 0 }, { level: 1 }];
  assert.deepEqual(listMarkers(items, defaultLevelFormats("multilevel")), ["1.", "a.", "b.", "2.", "a."]);
  assert.equal(canIndent(items, 0), false, "first item stays at level 0");
  assert.equal(canIndent(items, 1), false, "already one deeper than the item above");
  assert.equal(canIndent(items, 3), true);
  assert.equal(canIndent(items, 3, 4), true);
  assert.equal(canOutdent(items, 0), false); assert.equal(canOutdent(items, 1, 2), true);
  assert.deepEqual(shiftLevels(items, 1, 2, -1).map(i => i.level), [0, 0, 0, 0, 1]);
  assert.throws(() => shiftLevels(items, 1, 1, 1), RangeError);
  assert.throws(() => listMarkers([{ level: 9 }], []), RangeError);
});

test("H-07 authoritative markers preserve starts, mixed nonlist rows and the default counter contract",()=>{
  const formats=defaultLevelFormats("numbered");
  const plain=[{level:0},{level:1},{level:0}];
  assert.deepEqual(listPreviewMarkers(plain,formats,"numbered"),listMarkers(plain,formats));
  assert.deepEqual(listPreviewMarkers([{level:0,marker:"5."},{level:0,marker:""},{level:1,marker:"III."}],formats,"mixed"),["5.","","III."]);
  assert.deepEqual(listPreviewMarkers([{level:0,marker:"7."},{level:0}],formats,"none"),["7.",""]);
  assert.deepEqual(listPreviewMarkers([{level:0,marker:"Host"},{level:0}],formats,"numbered"),["Host","2."]);
  assert.deepEqual(BULLETS_NUMBERING_CAPABILITIES,{version:1,authoritativeMarkers:true});
  assert.equal(Object.isFrozen(BULLETS_NUMBERING_CAPABILITIES),true);
});
test("H-07 authoritative markers admit long valid letters and reject control, multiline and malformed text",()=>{
  const formats=defaultLevelFormats("numbered");
  assert.equal(listPreviewMarkers([{level:8,marker:"A".repeat(770)+"."}],formats,"mixed")[0].length,771);
  for(const marker of ["x\ny","x\ty","x\u2028y","x\u2029y","x\u202ey","\u0000","\ud800","a".repeat(LIST_PREVIEW_MARKER_MAX+1),null,7]){
    assert.throws(()=>listPreviewMarkers([{level:0,marker}],formats,"mixed"),RangeError);
  }
});

test("H-15 outline: relative depth, collapse, show level, caret and pages", () => {
  const h = [
    { id: "a", level: 2, text: "Intro", block: 0, page: 0 },
    { id: "b", level: 3, text: "Scope", block: 4, page: 0 },
    { id: "c", level: 4, text: "Detail", block: 6, page: 1 },
    { id: "d", level: 2, text: "Plan", block: 9, page: 2 },
  ];
  assert.deepEqual(visibleOutline(h, new Set()).map(r => [r.heading.id, r.depth, r.hasChildren]), [["a", 0, true], ["b", 1, true], ["c", 2, false], ["d", 0, false]]);
  assert.deepEqual(visibleOutline(h, new Set(["a"])).map(r => r.heading.id), ["a", "d"]);
  assert.deepEqual(visibleOutline(h, new Set(), 3).map(r => r.heading.id), ["a", "b", "d"]);
  assert.equal(headingAtBlock(h, 7), 2); assert.equal(headingAtBlock([{ ...h[0], block: 3 }], 1), -1);
  assert.equal(rowForHeading(visibleOutline(h, new Set(["a"])), 2), 0, "collapsed parent stands in for its child");
  assert.deepEqual(headingsByPage(h, 4).map(x => x?.id), ["a", "c", "d", undefined]);
  assert.throws(() => visibleOutline([{ id: "x", level: 0, text: "", block: 0 }], new Set()), RangeError);
  assert.throws(() => visibleOutline([{ ...h[1] }, { ...h[0] }], new Set()), RangeError);
});

test("J-01/J-02 slide order: moves, block moves, planned single moves, selection, grid", () => {
  const ids = ["a", "b", "c", "d", "e"];
  assert.deepEqual(moveId(ids, "a", 4), ["b", "c", "d", "e", "a"]);
  assert.throws(() => moveId(ids, "z", 0), RangeError);
  assert.deepEqual(moveBlock(ids, ["b", "d"], 0), ["b", "d", "a", "c", "e"]);
  assert.deepEqual(moveBlock(ids, ["d", "b"], 99), ["a", "c", "e", "b", "d"]);
  for (const after of [["e", "d", "c", "b", "a"], ["b", "d", "a", "c", "e"], ids]) {
    const cur = [...ids];
    for (const { from, to } of planMoves(ids, after)) { const [x] = cur.splice(from, 1); cur.splice(to, 0, x); }
    assert.deepEqual(cur, after);
  }
  assert.throws(() => planMoves(ids, ["a"]), RangeError);
  assert.deepEqual(nextSelection(ids, ["b"], "b", "d", "range"), { selected: ["b", "c", "d"], anchor: "b" });
  assert.deepEqual(nextSelection(ids, ["b"], "b", "b", "toggle").selected, []);
  assert.deepEqual(nextSelection(ids, ["b", "c"], "b", "e", "replace"), { selected: ["e"], anchor: "e" });
  assert.equal(gridColumns(390 - 32, 160, 12), 2); assert.equal(gridColumns(834 - 32, 160, 12), 4); assert.equal(gridColumns(0, 160, 12), 1);
  assert.equal(gridMove(1, "ArrowRight", 4, 10), 2); assert.equal(gridMove(1, "ArrowRight", 4, 10, true), 0);
  assert.equal(gridMove(8, "ArrowDown", 4, 10), undefined); assert.equal(gridMove(5, "Home", 4, 10), 0);
  const slide = { id: "s", objects: [{ id: "1", kind: "rect", x: 0, y: 0, w: 1, h: 1, rotation: 0 }, { id: "2", kind: "text", text: " Q3 plan\nmore", x: 0, y: 0, w: 1, h: 1, rotation: 0 }] };
  assert.equal(slideTitle(slide, 0), "Q3 plan");
  assert.equal(slideLabel(slide, 0, 3), "Slide 1 of 3, Q3 plan, 2 objects");
  assert.equal(rgbaCss([255, 0, 300, 128]), "rgba(255,0,255,0.502)");
});

test("J-05 canvas: snapping, resize, nudge, rotation, hit testing", () => {
  const size = { width: 960, height: 540 };
  const snapped = snapRect({ x: 478, y: 100, w: 4, h: 40 }, [{ x: 600, y: 300, w: 100, h: 100 }], size, 6);
  assert.equal(snapped.x, 478 + (480 - 480)); // center 480 already on the slide center
  const toEdge = snapRect({ x: 597, y: 403, w: 50, h: 50 }, [{ x: 600, y: 300, w: 100, h: 100 }], size, 6);
  assert.deepEqual([toEdge.x, toEdge.y], [600, 400]);
  assert.deepEqual(toEdge.guides, [{ axis: "x", at: 600 }, { axis: "y", at: 400 }]);
  assert.deepEqual(snapRect({ x: 300, y: 200, w: 10, h: 10 }, [], size, 2).guides, []);
  assert.deepEqual(resizeFromCorner({ x: 0, y: 0, w: 100, h: 50 }, 100, 0, true), { w: 200, h: 100 });
  assert.deepEqual(resizeFromCorner({ x: 0, y: 0, w: 100, h: 50 }, -500, -500), { w: 8, h: 8 });
  assert.deepEqual(nudge("ArrowLeft", true), { dx: -10, dy: 0 }); assert.deepEqual(nudge("ArrowLeft", false, true), { dx: 1, dy: 0 }); assert.equal(nudge("a", false), undefined);
  assert.equal(stepRotation(170, 1), 180); assert.equal(stepRotation(180, 1), -165); assert.equal(stepRotation(7, -1), -15);
  const objs = [{ id: "a", kind: "rect", x: 0, y: 0, w: 100, h: 100, rotation: 0 }, { id: "b", kind: "rect", x: 50, y: 50, w: 100, h: 100, rotation: 0 }];
  assert.equal(hitTest(objs, 60, 60).id, "b"); assert.equal(hitTest(objs, 10, 10).id, "a"); assert.equal(hitTest(objs, 500, 10), undefined);
  assert.equal(fitScale(size, 480), 0.5); assert.equal(fitScale(size, 960, 270), 0.5); assert.equal(fitScale(size, 0), 0);
  assert.equal(objectLabel({ id: "t", kind: "text", text: "Hi", x: 1.4, y: 2, w: 3, h: 4, rotation: 15 }), "Text box, Hi, at 1, 2, 3 by 4, rotated 15 degrees");
});

test("J-09 animations: play order, end time, seconds parsing, labels", () => {
  const a = [{ index: 0, objectId: "x", kind: "fadeIn", startS: 1, durationS: 0.5 }, { index: 1, objectId: "y", kind: "zoomIn", startS: 0, durationS: 2 }, { index: 2, objectId: "z", kind: "odd", startS: 1, durationS: 1 }];
  assert.deepEqual(playOrder(a).map(x => x.index), [1, 0, 2]);
  assert.equal(timelineEnd(a), 2); assert.equal(timelineEnd([]), 0);
  assert.deepEqual(parseSeconds("1,5 s", { allowZero: false }), { value: 1.5 });
  assert.deepEqual(parseSeconds("0", { allowZero: true }), { value: 0 });
  assert.ok("error" in parseSeconds("0", { allowZero: false }));
  assert.ok("error" in parseSeconds("abc", { allowZero: true }));
  assert.ok("error" in parseSeconds("601", { allowZero: true }));
  const entrance = [SLIDE_ANIMATION_EFFECTS.fadeIn];
  assert.equal(effectLabel("fadeIn", entrance), "Fade in"); assert.equal(effectLabel("zoomOut", entrance), "Zoom out"); assert.equal(effectLabel("odd", entrance), "odd");
});

test("ported files carry source, commit, copyright, both licenses and a modification notice", () => {
  const ports = [
    ["src/office/read-aloud-model.ts", "wordcraft-android/commit/b2b7cf913c6f61604062e2db30962f32ec921b11", "WordCraft"],
    ["src/pdf/search-model.ts", "pdfcraft-android/commit/c643244e0e00c1f0b746ceaff4661a91921e907e", "PdfCraft"],
  ];
  for (const [file, commit, name] of ports) {
    const head = readFileSync(resolve(root, file), "utf8").split("\n").slice(0, 12).join("\n");
    assert.ok(head.includes(commit), file);
    assert.ok(head.includes(`Copyright (c) 2026 ArtCraft Team and the ${name} contributors.`), file);
    assert.ok(head.includes("MIT License or the Apache License, Version 2.0"), file);
    assert.ok(/Modified by NYC-Tron UI contributors, 2026-11-05/.test(head), file);
    for (const lic of ["MIT", "Apache-2.0", "NOTICE"]) assert.ok(existsSync(resolve(root, `licenses/${name}-${lic}.txt`)), `${name}-${lic}`);
  }
  // The package carries its own notices and license texts, as packages/prism and
  // packages/quill do; NYC-Tron kept them at its repository root.
  const notices = readFileSync(resolve(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const [file] of ports) assert.ok(notices.includes(file), file);
});

test("office controls never import engine packages and draw only what a callback backs", () => {
  const files = ["office/ReadAloudTransport.tsx", "slides/SlideCanvas.tsx", "slides/SlideFilmstrip.tsx", "slides/SlideSorter.tsx",
    "slides/SlideAnimationPane.tsx", "document/RichTextRibbon.tsx", "document/BulletsNumberingEditor.tsx", "document/NavigationOutline.tsx",
    "pdf/TextSearchResults.tsx", "pdf/AnnotationToolbar.tsx", "pdf/CommentsThreadPanel.tsx", "pdf/PDFReadAloudTransport.tsx",
    "document/DocumentReadAloudTransport.tsx"];
  for (const f of files) {
    const text = readFileSync(resolve(root, "src", f), "utf8");
    assert.ok(!/from\s+["'](?:@nitro-forge\/|@acme\/)/.test(text), f);
    assert.ok(!/useState\b/.test(text), `${f} keeps local state in useLocalStore`);
  }
  const ribbon = readFileSync(resolve(root, "src/document/RichTextRibbon.tsx"), "utf8");
  for (const cb of ["onToggle", "onColorChange", "onHighlightChange", "onFontFamilyChange", "onFontSizeChange", "onChangeCase", "onParagraphStyleChange"])
    assert.ok(new RegExp(`\\{${cb}(&&|\\?)`).test(ribbon), `ribbon group for ${cb} is conditional`);
});
