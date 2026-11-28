import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 INK_BOARD_TOOLS,INK_ENABLED,INK_SIZES,INK_SIZE_POINTS,INK_TOUCH_TARGET,formatInkOpacity,inkSizePreviewDiameter,
 normalizeInkOpacity,planInkCommand,resolveInkShortcut,stepInkOpacity,stepInkSize,validateInkToolbar,
} from "../src/ink/ink-model.ts";

const source=readFileSync(new URL("../src/ink/InkToolbar.tsx",import.meta.url),"utf8");
const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const tools=INK_BOARD_TOOLS.map(tool=>({tool}));
const state={tools,tool:"pen",size:"m",undo:INK_ENABLED,redo:{enabled:false,reason:"Nothing to redo"}};

test("defaults mirror the Forge board: three tools and QuickDraw sizes",()=>{
 assert.deepEqual([...INK_BOARD_TOOLS],["pen","highlighter","eraser"]);
 assert.deepEqual([...INK_SIZES],["s","m","l","xl"]);
 assert.deepEqual(INK_SIZE_POINTS,{s:2.5,m:4,l:6.5,xl:10});
 assert.equal(INK_TOUCH_TARGET,44);
});
test("validation rejects state the toolbar cannot show honestly",()=>{
 assert.doesNotThrow(()=>validateInkToolbar(state));
 assert.throws(()=>validateInkToolbar({...state,tools:[]}),/at least one/);
 assert.throws(()=>validateInkToolbar({...state,tools:[...tools,{tool:"pen"}]}),/Duplicate ink tool/);
 assert.throws(()=>validateInkToolbar({...state,tools:[{tool:"brush"}],tool:"brush"}),/Unknown ink tool/);
 assert.throws(()=>validateInkToolbar({...state,tool:"lasso"}),/not offered/);
 assert.throws(()=>validateInkToolbar({...state,size:"xxl"}),/size/);
 assert.throws(()=>validateInkToolbar({...state,swatches:[{id:"a",label:"A",value:"red"}],color:"b"}),/no swatch/);
 assert.throws(()=>validateInkToolbar({...state,swatches:[{id:"a",label:"A",value:"red"},{id:"a",label:"B",value:"blue"}]}),/Duplicate/);
 assert.throws(()=>validateInkToolbar({...state,opacity:1.2}),/0\.\.1/);
 assert.throws(()=>validateInkToolbar({...state,undo:{enabled:false,reason:" "}}),/reason/);
 assert.throws(()=>validateInkToolbar({...state,tools:[{tool:"pen",disabledReason:""}]}),/reason/);
});
test("size and opacity steps clamp at the ends",()=>{
 assert.equal(stepInkSize("m",1),"l");
 assert.equal(stepInkSize("xl",1),"xl");
 assert.equal(stepInkSize("s",-1),"s");
 assert.throws(()=>stepInkSize("huge",1),RangeError);
 assert.equal(stepInkOpacity(0.4,1),0.5);
 assert.equal(stepInkOpacity(0.1,-1),0.1,"opacity never steps to an invisible stroke");
 assert.equal(stepInkOpacity(1,1),1);
 assert.equal(normalizeInkOpacity(0.333),0.33);
 assert.equal(formatInkOpacity(0.554),"55%");
});
test("size preview dot grows with size, highlighter is wider, and fits the target",()=>{
 const pen=INK_SIZES.map(s=>inkSizePreviewDiameter(s,"pen"));
 assert.deepEqual([...pen].sort((a,b)=>a-b),pen);
 assert.ok(inkSizePreviewDiameter("s","highlighter")>inkSizePreviewDiameter("s","pen"));
 for(const s of INK_SIZES)assert.ok(inkSizePreviewDiameter(s,"highlighter")<=28);
});
test("shortcuts map letters, brackets and platform undo/redo without shadowing menus",()=>{
 assert.deepEqual(resolveInkShortcut({key:"p"}),{type:"select-tool",tool:"pen"});
 assert.deepEqual(resolveInkShortcut({key:"E"}),{type:"select-tool",tool:"eraser"});
 assert.deepEqual(resolveInkShortcut({key:"]"}),{type:"size",direction:1});
 assert.deepEqual(resolveInkShortcut({key:"z",metaKey:true}),{type:"undo"});
 assert.deepEqual(resolveInkShortcut({key:"Z",ctrlKey:true,shiftKey:true}),{type:"redo"});
 assert.deepEqual(resolveInkShortcut({key:"y",ctrlKey:true}),{type:"redo"});
 assert.equal(resolveInkShortcut({key:"y",metaKey:true}),undefined);
 assert.equal(resolveInkShortcut({key:"p",metaKey:true}),undefined,"Cmd+P stays the app's print shortcut");
 assert.equal(resolveInkShortcut({key:"z",metaKey:true,altKey:true}),undefined);
 assert.equal(resolveInkShortcut({key:"q"}),undefined);
 assert.deepEqual(resolveInkShortcut({nativeEvent:{key:"h"}}),{type:"select-tool",tool:"highlighter"});
});
test("commands resolve to host calls or an honest notice",()=>{
 assert.deepEqual(planInkCommand({type:"select-tool",tool:"eraser"},state),{kind:"tool",tool:"eraser"});
 assert.deepEqual(planInkCommand({type:"select-tool",tool:"pen"},state),{kind:"none"});
 assert.deepEqual(planInkCommand({type:"select-tool",tool:"lasso"},state),{kind:"none"},"tools the board lacks are ignored");
 const blocked={...state,tools:[{tool:"pen"},{tool:"eraser",disabledReason:"Layer is locked"}]};
 assert.deepEqual(planInkCommand({type:"select-tool",tool:"eraser"},blocked),{kind:"notice",message:"Layer is locked"});
 assert.deepEqual(planInkCommand({type:"size",direction:1},state),{kind:"size",size:"l"});
 assert.deepEqual(planInkCommand({type:"size",direction:1},{...state,size:"xl"}),{kind:"notice",message:"Already the largest size"});
 assert.deepEqual(planInkCommand({type:"undo"},state),{kind:"undo"});
 assert.deepEqual(planInkCommand({type:"redo"},state),{kind:"notice",message:"Nothing to redo"});
});
test("toolbar exposes radio groups, an adjustable size, and no engine or palette",()=>{
 assert.match(source,/role="radiogroup" aria-label="Tool"/);
 assert.match(source,/role="radiogroup" aria-label="Color"/);
 assert.match(source,/accessibilityRole="adjustable"/);
 assert.match(source,/role="toolbar"/);
 assert.match(source,/pressure!==undefined&&onPressureChange/,"pressure toggle only when the host reports hardware support");
 assert.doesNotMatch(source,/addEventListener|document\.|window\./,"no global key listener");
 assert.doesNotMatch(source,/from\s+["'](?:@nitro-forge\/|@shopify\/react-native-skia|react-native-ble)/,"no engine, renderer or BLE import");
 assert.doesNotMatch(source,/["'`]#[0-9A-Fa-f]{3,8}["'`]/);
 for(const sub of ["ink/InkToolbar","ink/ink-model"])assert.ok(pkg.exports["./"+sub],sub);
});
