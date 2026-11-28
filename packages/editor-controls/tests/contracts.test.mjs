import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,existsSync,readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve,dirname } from "node:path";
import { resamplePeaks,peaksToBars } from "../src/waveform.ts";
import { FRAME_RATES,formatTimecode,frameToPosition,positionToFrame } from "../src/timebase.ts";
import { rgbaToHex } from "../src/color.ts";
import { sheetWindow,cellAddress,columnName,responsiveSheetMetrics,reanchorSheetScroll } from "../src/sheet-window.ts";
import { TRON_THEME_TOKENS } from "@nyc-tron/core/theme";
const pkgPath=new URL("../package.json",import.meta.url);
const root=dirname(fileURLToPath(pkgPath));
const pkg=JSON.parse(readFileSync(pkgPath,"utf8"));
// Moved from NYC-Tron UI's contracts.test.mjs with the editor controls. NYC-Tron
// keeps the checks of its own components; this file holds the editor-control half.
test("all direct component export targets are actual independent files",()=>{
 const exists=entry=>{
  const base=entry.replace("/dist/","/src/").replace(/\.d\.ts$|\.js$/,"");
  return existsSync(resolve(root,entry))||existsSync(resolve(root,base+".ts"))||existsSync(resolve(root,base+".tsx"));
 };
 for(const [subpath,target] of Object.entries(pkg.exports)){
  const entries=typeof target==="string"?{default:target}:target;
  assert.equal(typeof entries.default,"string",`Expected ESM export path for ${subpath}`);
  for(const [condition,entry] of Object.entries(entries))
   assert.ok(exists(entry),`Missing source or compiled export ${subpath} (${condition}): ${entry}`);
 }
 assert.ok(pkg.exports["./WaveformLane"]);
 assert.ok(!Object.keys(pkg.exports).some(k=>k.startsWith("./components/")),"subpaths drop the NYC-Tron components/forge prefix");
});
test("Forge controls never import engine packages or app-specific palettes",()=>{
 for(const file of [
  "NativeSeekBar.native.tsx","NativeSeekBar.web.tsx","NativeSeekBar.shared.tsx","NativeSeekBar.types.ts","WaveformLane.tsx","ColorChannels.tsx",
  "waveform.ts","color.ts","timebase.ts","audio/level.ts","audio/LevelFader.tsx",
  "color/HsvPicker.tsx","color/fieldGeometry.ts","color/fieldGesture.ts",
  "audio/pan.ts","audio/PanControl.tsx","audio/SoloMuteButtons.tsx","audio/mixer.ts","audio/ChannelStrip.tsx",
  "audio/MixingConsole.tsx","audio/tempo.ts","audio/TempoAndMetronome.tsx",
  "midi/note-grid.ts","midi/MIDIPianoRoll.tsx","midi/MIDIVelocityLane.tsx","midi/StepSequencer.tsx"
 ]){
  const text=readFileSync(resolve(root,"src",file),"utf8");
  assert.ok(!/from\s+["'](?:@nitro-forge\/|@acme\/|@reactvision\/)/.test(text),file);
 }
});
test("waveform preserves real signal extrema and bounds view work",()=>{
 const peaks=[{min:-1,max:1},{min:-0.25,max:0.4}];
 assert.deepEqual(resamplePeaks(peaks,1),[{min:-1,max:1}]);
 const bars=peaksToBars(resamplePeaks(peaks,2),64);
 assert.deepEqual(bars[0],{top:0,height:64});
 assert.throws(()=>resamplePeaks(peaks,9000),/columns/);
});
test("frame math returns whole bounded frames and SMPTE display",()=>{
 assert.equal(positionToFrame(0.5,101),51);
 assert.equal(frameToPosition(15,30),0.5);
 assert.equal(formatTimecode(30,FRAME_RATES.VIDEO_30),"00:00:01:00");
 assert.match(formatTimecode(1800,FRAME_RATES.NTSC_2997,{dropFrame:true}),/;/);
});
test("RGBA math is document-agnostic and validates channels",()=>{
 assert.equal(rgbaToHex({r:255,g:0,b:0,alpha:1}),"#FF0000FF");
 assert.throws(()=>rgbaToHex({r:300,g:0,b:0,alpha:1}),/RGB/);
});

test("Spreadsheet window virtualizes both rows and columns without allocating full sheet",()=>{
  const viewport=sheetWindow({rowCount:1048576,columnCount:16384,
    scrollX:0,scrollY:0,viewportWidth:1000,viewportHeight:600,rowHeight:32,columnWidth:112});
  assert.ok(viewport.rows.end-viewport.rows.start<50);
  assert.ok(viewport.columns.end-viewport.columns.start<20);
  const moved=sheetWindow({rowCount:1048576,columnCount:16384,
    scrollX:1200,scrollY:1280,viewportWidth:1000,viewportHeight:600,rowHeight:32,columnWidth:112});
  assert.ok(moved.rows.start>0);
  assert.ok(moved.columns.start>0);
  assert.equal(columnName(26),"AA");
  assert.equal(cellAddress(0,26),"AA1");
  assert.equal(cellAddress(99,0),"A100");
});

test("Tally mobile grid keeps all spreadsheet columns, touch targets and formula input",()=>{
  for(const width of [280,320,360,390,480,539]){
    const m=responsiveSheetMetrics({width,rowHeight:32,columnWidth:100});
    assert.equal(m.compact,true,String(width));
    assert.ok(m.rowHeight>=44);
    assert.ok(m.columnWidth>=112);
    assert.equal(m.formulaBarHeight,92);
    const visible=sheetWindow({
      rowCount:1048576,columnCount:16384,scrollX:0,scrollY:0,
      viewportWidth:width,
      viewportHeight:600-m.formulaBarHeight,
      rowHeight:m.rowHeight,columnWidth:m.columnWidth,
      rowHeaderWidth:m.rowHeaderWidth,columnHeaderHeight:m.columnHeaderHeight
    });
    assert.ok(visible.columns.end-visible.columns.start<=8);
    assert.ok(visible.rows.end-visible.rows.start<=20);
    assert.equal(visible.totalWidth,m.rowHeaderWidth+16384*m.columnWidth);
  }
  const landscape=responsiveSheetMetrics({width:900,rowHeight:32,columnWidth:112});
  assert.equal(landscape.compact,false);
  assert.equal(landscape.rowHeight,32);
  assert.equal(landscape.formulaBarHeight,46);
  assert.throws(()=>responsiveSheetMetrics({width:-1}),/metrics/);
});

test("responsive implementation measures host panes, not window screen dimensions",()=>{
  const grid=readFileSync(resolve(root,"src/SpreadsheetGrid.tsx"),"utf8");
  assert.ok(grid.includes("onLayout={event=>"));
  assert.ok(grid.includes('metrics.compact?"column":"row"'));
  assert.ok(grid.includes("onWindowChangeRef"));
  assert.ok(!grid.includes("useWindowDimensions"));
});

test("portrait-landscape and foldable split resize retain selected sheet region",()=>{
  const wide={rowHeight:32,columnWidth:112,rowHeaderWidth:52};
  const compact={rowHeight:44,columnWidth:112,rowHeaderWidth:48};
  const before={x:52+112*23.5,y:32*800.25};
  const after=reanchorSheetScroll(before,wide,compact);
  assert.equal(after.x,48+112*23.5);
  assert.equal(after.y,44*800.25);
  const back=reanchorSheetScroll(after,compact,wide);
  assert.deepEqual(back,before);
  assert.deepEqual(reanchorSheetScroll({x:0,y:0},wide,compact),{x:0,y:0});
  assert.throws(()=>reanchorSheetScroll({x:0,y:0},{...wide,rowHeight:0},compact),/anchors/);
});

const componentSources=(dir=resolve(root,"src"))=>
  readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()
    ? componentSources(resolve(dir,e.name))
    : /\.tsx?$/.test(e.name)?[resolve(dir,e.name)]:[]);
test("every semantic token a component uses is documented for consumers",()=>{
  // NYC-Tron documents its tokens in docs/THEME_TOKENS.md, which is not in the
  // release tarball; @nyc-tron/core/theme exports the same CSS variable names.
  const documented=new Set(Object.values(TRON_THEME_TOKENS).flatMap(Object.values).map(v=>v.replace(/^--(?:color|radius)-/,"")));
  const tokenClass=/\b(?:bg|text|border|ring|rounded)-((?:on-)?(?:primary|danger)|info|success|surface-(?:raised|sunken)|text(?:-muted)?|accent|border|focus|control|card)\b/g;
  const used=new Set();
  for(const file of componentSources()){
    for(const m of readFileSync(file,"utf8").matchAll(tokenClass))used.add(m[1]);
  }
  assert.ok(used.size>5);
  for(const token of used)assert.ok(documented.has(token),`Undocumented token ${token}`);
  // Names a theme might define but no component recipe documents. Only
  // string literals are checked, so prose in comments cannot trip it.
  const legacy=new Set(["text-foreground","bg-surface","text-muted","bg-background","border-surface"]);
  for(const file of componentSources()){
    const literals=readFileSync(file,"utf8").match(/"[^"\n]*"|'[^'\n]*'/g)??[];
    for(const lit of literals)for(const cls of lit.slice(1,-1).split(/\s+/)){
      assert.ok(!legacy.has(cls),`${file} uses undocumented token ${cls}`);
    }
  }
});
test("interactive controls keep screen-reader semantics",()=>{
  const read=p=>readFileSync(resolve(root,"src",p),"utf8");
  const wave=read("WaveformLane.tsx");
  assert.ok(!/onSeekNormalized\((?:0|1)\)/.test(wave),"a11y steps must not jump to clip ends");
  assert.ok(wave.includes("accessibilityStep"));
});
test("components take colors from theme tokens, not hardcoded hex values",()=>{
  for(const file of componentSources()){
    const text=readFileSync(file,"utf8");
    const hex=text.match(/["'`]#[0-9A-Fa-f]{3,8}["'`]/g);
    assert.equal(hex,null,`${file} hardcodes ${hex}`);
  }
});
test("every adjustable control can be adjusted by a screen reader",()=>{
  for(const file of componentSources()){
    const text=readFileSync(file,"utf8");
    const adjustable=(text.match(/accessibilityRole=(?:"adjustable"|\{[^}]*"adjustable")/g)??[]).length;
    const actions=(text.match(/accessibilityActions=/g)??[]).length;
    assert.ok(actions>=adjustable,`${file}: ${adjustable} adjustable roles but ${actions} action sets`);
  }
});
// RN 0.88 ReactAccessibilityDelegate.AccessibilityRole.fromValue throws
// IllegalArgumentException for anything outside this list; ARIA-only roles
// such as row/cell/columnheader must go through the `role` prop instead.
const ANDROID_ACCESSIBILITY_ROLES=new Set(["none","button","dropdownlist","togglebutton","link","search","image",
  "imagebutton","keyboardkey","text","adjustable","summary","header","alert","checkbox","combobox","menu","menubar",
  "menuitem","progressbar","radio","radiogroup","scrollbar","spinbutton","switch","tab","tabbar","tablist","timer",
  "list","grid","pager","scrollview","horizontalscrollview","viewgroup","webview","drawerlayout","slidingdrawer",
  "iconmenu","toolbar"]);
test("accessibilityRole only uses values Android's enum accepts",()=>{
  let checked=0;
  for(const file of componentSources()){
    const text=readFileSync(file,"utf8");
    for(const m of text.matchAll(/accessibilityRole=(\{[^}]*\}|"[^"]*")/g)){
      for(const role of m[1].matchAll(/"([a-z]+)"/g)){
        assert.ok(ANDROID_ACCESSIBILITY_ROLES.has(role[1]),`${file}: accessibilityRole "${role[1]}" crashes Android; use role=`);
        checked++;
      }
    }
  }
  assert.ok(checked>20);
});
test("data grids expose grid semantics instead of per-cell buttons",()=>{
  const sheet=readFileSync(resolve(root,"src/SpreadsheetGrid.tsx"),"utf8");
  for(const role of ["grid","row","columnheader","rowheader","cell"])assert.ok(sheet.includes(`role="${role}"`),role);
  assert.ok(!sheet.includes('accessibilityRole="button"'),"spreadsheet cells are not buttons");
  assert.ok(!sheet.includes("navigator.clipboard")&&!sheet.includes("Clipboard."),"the app writes the clipboard");
});
