import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// #27: the Forge original puts the step buttons and timecode on one row under
// the slider. The rendered check is tests/browser/seekbar.spec.mjs; the
// preview/commit contract is tests/render/native-seek-bar.render.test.mjs.
const read=name=>readFileSync(new URL("../src/"+name,import.meta.url),"utf8");
const shared=read("NativeSeekBar.shared.tsx");
const platforms={native:read("NativeSeekBar.native.tsx"),web:read("NativeSeekBar.web.tsx")};

test("NativeSeekBar puts the frame buttons and timecode in one row under the slider",()=>{
 const slider=shared.indexOf("{slider}");
 assert.ok(slider>0,"the platform slider renders first");
 const after=shared.slice(slider);
 const rowStart=after.indexOf("<View style={{ flexDirection: \"row\"");
 const rowEnd=after.indexOf("</View>",rowStart);
 assert.ok(rowStart>0&&rowEnd>rowStart,"one row after the slider");
 const row=after.slice(rowStart,rowEnd);
 assert.equal(row.match(/<Button\b/g)?.length,2,"both step buttons in the row");
 assert.equal(row.match(/<Text\b/g)?.length,1,"timecode in the row");
 const order=["−${stepFrames} frame","<Text","+${stepFrames} frame"].map(s=>row.indexOf(s));
 assert.deepEqual([...order].sort((a,b)=>a-b),order,"back, timecode, forward");
});
test("the @expo/ui host carries only the slider on every platform",()=>{
 for(const [name,source] of Object.entries(platforms)){
  const host=source.slice(source.indexOf("<Host"),source.indexOf("</Host>"));
  assert.ok(!/<Button\b|<Text\b/.test(host),name);
  assert.ok(!/from\s*"@expo\/ui[^"]*"[^;]*\bText\b/.test(source)&&!/\bText\b[^}]*\}\s*from\s*"@expo\/ui/.test(source),
   name+" imports no @expo/ui Text");
 }
});
test("transport follows the app theme, not the OS scheme",()=>{
 assert.match(shared,/import\s*\{[^}]*\bText\b[^}]*\}\s*from\s*"react-native"/);
 assert.match(shared,/import\s*\{\s*Button\s*\}\s*from\s*"@nyc-tron\/ui\/components\/Button"/);
 assert.match(shared,/<Text selectable \{\.\.\.\{ className: joinClasses\(!unstyled && "text-text"\) \}\}/);
});
test("each platform wires the OS end-of-drag event to the commit",()=>{
 assert.match(platforms.native,/onEditingChanged=\{/,"SwiftUI drag end");
 assert.match(platforms.native,/onValueChangeFinished=\{/,"Compose drag end");
 assert.match(platforms.web,/addEventListener\("change"/,"range input change");
 for(const source of Object.values(platforms))assert.ok(!/onSeek\(/.test(source),"no direct onSeek call");
});
