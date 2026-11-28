import {test,expect} from "playwright/test";

test.beforeEach(async({page})=>{await page.setViewportSize({width:834,height:1300});});
const text=async(page,id)=>(await page.getByTestId(id).textContent())??"";
const clipsOf=async page=>Object.fromEntries((await text(page,"clips")).replace(/^clips /,"").split(" ")
  .map(s=>{const [id,rest]=s.split("@");const [start,len]=rest.split("+").map(Number);return [id,{start,len}];}));
const ppf=async page=>Number((await text(page,"view")).split(" ")[2]);
async function dragBy(page,locator,dx,dy=0,{release=true,fx=0.5}={}){
  const b=await locator.boundingBox();
  const x=b.x+b.width*fx,y=b.y+b.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+dx/3,y+dy/3,{steps:3});
  await page.mouse.move(x+dx,y+dy,{steps:5});
  if(release)await page.mouse.up();
}
const clip=(page,name)=>page.getByRole("button",{name:new RegExp("^"+name+",")});

test("dragging the selected clip moves it once, through the engine's moveClip",async({page})=>{
  await page.goto("/timeline?select=12&frame=0");
  const before=(await clipsOf(page))["12"];
  const p=await ppf(page);
  // Ten frames later: clear of the next clip (288) and of every snap target.
  await dragBy(page,clip(page,"Ferry close-up"),10*p,0,{fx:0.4});
  await expect(page.getByTestId("commits")).toHaveText("commits 1");
  await expect(page.getByTestId("last")).toHaveText("last move moveClip");
  const after=(await clipsOf(page))["12"];
  expect(after.start).toBeGreaterThan(before.start);
  expect(after.len).toBe(before.len);
});

test("a move onto a neighbour shows the overlap and commits nothing",async({page})=>{
  await page.goto("/timeline?select=12&frame=0");
  // The initial zoom clips this long clip; fit it before choosing an interior drag target.
  await page.getByTestId("zoom-fit-all").click();
  const before=(await clipsOf(page))["12"];
  const p=await ppf(page);
  await dragBy(page,clip(page,"Ferry close-up"),-60*p,0,{release:false,fx:0.6});
  await expect(page.getByText("Overlaps another clip")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("commits")).toHaveText("commits 0");
  expect((await clipsOf(page))["12"]).toEqual(before);
});

test("trims commit once and apply in the order the engine needs",async({page})=>{
  await page.goto("/timeline?select=12&frame=0");
  // Fit the whole timeline so both edges of the clip are on screen.
  await page.getByTestId("zoom-fit-all").click();
  const p=await ppf(page);
  const before=(await clipsOf(page))["12"];
  await dragBy(page,page.getByRole("slider",{name:"End of Ferry close-up"}),-24*p);
  await expect(page.getByTestId("last")).toHaveText("last trim trimClip");
  expect((await clipsOf(page))["12"].len).toBeLessThan(before.len);
  await dragBy(page,page.getByRole("slider",{name:"Start of Ferry close-up"}),12*p);
  await expect(page.getByTestId("last")).toHaveText("last trim trimClip+moveClip");
  await dragBy(page,page.getByRole("slider",{name:"Start of Ferry close-up"}),-6*p);
  await expect(page.getByTestId("last")).toHaveText("last trim moveClip+trimClip");
  await expect(page.getByTestId("commits")).toHaveText("commits 3");
  // Keyboard: Right moves the tail one frame later.
  const tail=page.getByRole("slider",{name:"End of Ferry close-up"});
  const len=(await clipsOf(page))["12"].len;
  await tail.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("commits")).toHaveText("commits 4");
  expect((await clipsOf(page))["12"].len).toBe(len+1);
});

test("split at playhead and the razor both split once",async({page})=>{
  await page.goto("/timeline?select=12&frame=150");
  await page.getByTestId("razor-split").click();
  await expect(page.getByTestId("last")).toHaveText("last split splitClip");
  expect(Object.keys(await clipsOf(page)).length).toBe(4);
  await page.getByRole("switch",{name:"Razor"}).click();
  await clip(page,"Harbor wide").click();
  await expect(page.getByTestId("commits")).toHaveText("commits 2");
  expect(Object.keys(await clipsOf(page)).length).toBe(5);
});

test("split is disabled with a reason when nothing is under the playhead",async({page})=>{
  await page.goto("/timeline?frame=150");
  await expect(page.getByTestId("razor-split")).toBeDisabled();
  await expect(page.getByText("Select a clip to split it.")).toBeVisible();
});

test("ruler drag scrubs and seeks once; the playhead steps by frame and second",async({page})=>{
  await page.goto("/timeline?frame=0");
  const ruler=page.getByTestId("ruler");
  await dragBy(page,ruler,40,0,{fx:0.3,release:false});
  await expect(page.getByTestId("commits")).toHaveText("commits 0");
  await page.mouse.up();
  await expect(page.getByTestId("commits")).toHaveText("commits 1");
  const frame=Number((await text(page,"frame")).split(" ")[1]);
  expect(frame).toBeGreaterThan(0);
  const head=page.getByRole("slider",{name:"Playhead"});
  await head.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("frame")).toHaveText("frame "+(frame+1));
  await page.keyboard.press("PageUp");
  await expect(page.getByTestId("frame")).toHaveText("frame "+(frame+25));
  await expect(head).toHaveAttribute("aria-valuetext",/^00:00:\d\d:\d\d$/);
});

test("seek bar Escape restores the frame without seeking",async({page})=>{
  await page.goto("/timeline?frame=30");
  const seek=page.getByRole("slider",{name:"Playback position"});
  await seek.focus();
  await dragBy(page,seek,120,0,{release:false,fx:0.2});
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("commits")).toHaveText("commits 0");
  await expect(seek).toHaveAttribute("aria-valuenow","30");
  await page.keyboard.press("End");
  await expect(page.getByTestId("frame")).toHaveText("frame 360");
});

test("transport, timecode entry, format switch and playback rate",async({page})=>{
  await page.goto("/timeline?frame=30");
  await page.getByRole("button",{name:"Next frame"}).click();
  await expect(page.getByTestId("frame")).toHaveText("frame 31");
  // Play/pause keeps keyboard focus across the toggle.
  await page.getByRole("button",{name:"Play",exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button",{name:"Pause",exact:true})).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button",{name:"Play",exact:true})).toBeFocused();
  const tc=page.getByTestId("tc-input");
  const before=Number((await text(page,"commits")).split(" ")[1]);
  await tc.fill("00:00:02:00");await tc.press("Enter");
  await expect(page.getByTestId("frame")).toHaveText("frame 48");
  // Enter then blur is still one commit.
  await tc.blur();
  await expect(page.getByTestId("commits")).toHaveText("commits "+(before+1));
  await tc.fill("00:00:02:30");await tc.press("Enter");
  await expect(page.getByText("Enter HH:MM:SS:FF.")).toBeVisible();
  await page.getByTestId("tc-format").click();
  await expect(tc).toHaveValue("48 f");
  await page.getByTestId("tc-format").click();
  await expect(tc).toHaveValue("2.000 s");
  await page.getByTestId("tc-format").click();
  await expect(tc).toHaveValue("00:00:02.000");
  await page.getByTestId("rate-toggle").click();
  await page.getByRole("radio",{name:"2x"}).click();
  await expect(page.getByTestId("speed")).toHaveText("speed 2 pitch true");
  await expect(page.getByRole("radio",{name:"2x"})).toHaveCount(0);
});

test("in and out marks set at the playhead and adjust by key",async({page})=>{
  await page.goto("/timeline?frame=24");
  await page.getByTestId("inout-set-in").click();
  await page.getByRole("button",{name:"Next frame"}).click();
  await page.getByTestId("inout-set-out").click();
  await expect(page.getByText("In 00:00:01:00, out 00:00:01:01")).toBeVisible();
  const out=page.getByRole("slider",{name:"Out point"});
  await out.focus();
  await page.keyboard.press("PageUp");
  await expect(page.getByText("In 00:00:01:00, out 00:00:02:01")).toBeVisible();
  // Pressing a mark off its centre (no drag) leaves it where it is.
  const ob=await out.boundingBox();
  const commits=await text(page,"commits");
  await page.mouse.click(ob.x+ob.width-4,ob.y+ob.height/2);
  await expect(page.getByText("In 00:00:01:00, out 00:00:02:01")).toBeVisible();
  await expect(page.getByTestId("commits")).toHaveText(commits);
  await page.getByTestId("inout-clear").click();
  await expect(page.getByText("No range marked")).toBeVisible();
});

test("zoom, fit and lane panning change the view without committing edits",async({page})=>{
  await page.goto("/timeline?select=12&frame=150");
  const p0=await ppf(page);
  await page.getByTestId("zoom-zoom-in").click();
  expect(await ppf(page)).toBeGreaterThan(p0);
  await page.getByTestId("zoom-fit-selection").click();
  const lanes=await page.getByTestId("lanes").boundingBox();
  const sel=await clip(page,"Ferry close-up").boundingBox();
  expect(sel.x).toBeGreaterThanOrEqual(lanes.x);
  expect(sel.x+sel.width).toBeLessThanOrEqual(lanes.x+lanes.width+1);
  const view=await text(page,"view");
  // Pan by dragging the empty lane space after the last video clip.
  await page.getByTestId("zoom-fit-all").click();
  const before=await text(page,"view");
  await page.getByTestId("zoom-zoom-in").click();
  await page.getByTestId("zoom-zoom-in").click();
  const zoomed=await text(page,"view");
  const lane=page.getByTestId("lanes");
  const lb=await lane.boundingBox();
  // Drag right on the audio lane's unselected clip: earlier in time, which is
  // never clamped while the view starts after frame 0.
  await page.mouse.move(lb.x+150,lb.y+56+28);await page.mouse.down();
  await page.mouse.move(lb.x+290,lb.y+56+28,{steps:6});await page.mouse.up();
  expect(await text(page,"view")).not.toBe(zoomed);
  expect(view).not.toBe(before);
  await expect(page.getByTestId("commits")).toHaveText("commits 0");
  // Mini-map keyboard scroll.
  const mini=page.getByRole("slider",{name:"Timeline scroll position"});
  await mini.focus();
  const v1=await text(page,"view");
  await page.keyboard.press("ArrowLeft");
  expect(await text(page,"view")).not.toBe(v1);
});

test("clips select by click, nudge by key and announce their state",async({page})=>{
  await page.goto("/timeline?frame=0");
  const harbor=clip(page,"Harbor wide");
  await harbor.click();
  await expect(clip(page,"Harbor wide")).toHaveAccessibleName(/selected$/);
  await harbor.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("last")).toHaveText("last move moveClip");
  expect((await clipsOf(page))["11"].start).toBe(1);
});

test("NTSC drop-frame timecode round-trips through the field",async({page})=>{
  await page.goto("/timeline?rate=ntsc&frame=1800");
  const tc=page.getByTestId("tc-input");
  await expect(tc).toHaveValue("00:01:00;02");
  await tc.fill("00:00:10;00");await tc.press("Enter");
  await expect(page.getByTestId("frame")).toHaveText("frame 300");
});

test("Ctrl+wheel zooms at the pointer and Shift+wheel scrolls",async({page})=>{
  await page.goto("/timeline?frame=0");
  const lb=await page.getByTestId("lanes").boundingBox();
  await page.mouse.move(lb.x+200,lb.y+20);
  const p0=await ppf(page);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0,-200);
  await page.keyboard.up("Control");
  await expect.poll(()=>ppf(page)).toBeGreaterThan(p0);
  const v=await text(page,"view");
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0,120);
  await page.keyboard.up("Shift");
  await expect.poll(()=>text(page,"view")).not.toBe(v);
  await expect(page.getByTestId("commits")).toHaveText("commits 0");
});
