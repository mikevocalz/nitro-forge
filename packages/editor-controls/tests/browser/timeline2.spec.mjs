import {test,expect} from "playwright/test";

test.beforeEach(async({page})=>{await page.setViewportSize({width:834,height:1194});});
const open=async(page,query="")=>{await page.goto("/timeline2"+query);await page.getByTestId("stack-lanes").waitFor();};

test("shuttle clears held K when focus leaves before keyup",async({page})=>{
  await open(page);
  await page.getByTestId("jkl-l").focus();await page.keyboard.down("k");
  await page.getByTestId("batch-speed").focus();await page.keyboard.up("k");
  await page.getByTestId("jkl-l").focus();await page.keyboard.press("l");
  await expect(page.getByTestId("jkl-rate")).toHaveText("1x");
  await expect(page.getByTestId("frame")).toContainText("steps 0");
});

test("track rename Enter then blur commits once while the engine response is pending",async({page})=>{
  await open(page,"?renameDelay=250");
  const name=page.getByLabel("Name of video track Video 1",{exact:true});
  await name.fill("Picture");await name.press("Enter");await name.press("Tab");
  await expect(page.getByTestId("tracks")).toContainText("Picture");
  await page.waitForTimeout(400);
  await expect(page.getByTestId("commits")).toHaveText("commits 1");
});

test("slip nudge edits once and a locked clip refuses editing",async({page})=>{
  await open(page,"?select=22&tool=slip");
  await page.getByTestId("trim-nudge1").click();
  await expect(page.getByTestId("commits")).toHaveText("commits 1");
  await expect(page.getByTestId("last")).toHaveText("last slip slipClip");
  await open(page,"?select=41&tool=slip&locked=1");
  await expect(page.getByTestId("trim-nudge1")).toBeDisabled();
  await expect(page.getByTestId("trim-reason")).toContainText("Track locked");
});

test("loop drag previews, cancels with Escape, then commits once on release",async({page})=>{
  await open(page,"?loop=1");
  const handle=page.getByLabel("Loop end",{exact:true});
  const b=await handle.boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y,{steps:5});
  await expect(page.getByTestId("commits")).toHaveText("commits 0");
  await page.keyboard.press("Escape");await page.mouse.up();
  await expect(page.getByTestId("loop-state")).toContainText("48-144");
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y,{steps:5});await page.mouse.up();
  await expect(page.getByTestId("commits")).toHaveText("commits 1");
  await expect(page.getByTestId("last")).toHaveText("last loop setLoopRange");
});

test("transition preset and marker edits emit their matching operations",async({page})=>{
  await open(page);
  await page.getByRole("button",{name:/^Cut between Harbor wide and Ferry close-up/}).click();
  await page.getByRole("button",{name:"Apply to cut",exact:true}).click();
  await expect(page.getByTestId("last")).toHaveText("last transition addTransition");
  await page.getByTestId("markers-add").click();
  await expect(page.getByTestId("last")).toHaveText("last marker addMarker");
  await expect(page.getByTestId("commits")).toHaveText("commits 2");
});

test("batch shift and speed each emit one transaction",async({page})=>{
  await open(page,"?multi=23,24");
  await page.getByTestId("batch-later").click();
  await expect(page.getByTestId("last")).toHaveText("last batch batch");
  await page.getByTestId("batch-speed").click();
  await expect(page.getByTestId("commits")).toHaveText("commits 2");
});

for(const dir of ["ltr","rtl"])test(`phone ${dir} keeps the page contained and track settings reachable`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page,"?dir="+dir);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const settings=page.getByRole("button",{name:/^Music track settings/});
  const box=await settings.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  await settings.click();await expect(page.getByLabel("Name of audio track Music",{exact:true})).toBeVisible();
});


test("marker fields commit once with a pending response and Escape discards the next draft",async({page})=>{
  await open(page,"?markerDelay=1");
  await page.getByLabel(/^Marker Gulls/).first().click();
  const name=page.getByLabel("Marker name",{exact:true});
  await name.fill("Birds");await name.press("Enter");await name.press("Tab");
  await expect(page.getByTestId("markers-state")).toContainText("Birds");
  await page.waitForTimeout(400);
  await expect(page.getByTestId("commits")).toHaveText("commits 1");
  await name.fill("Discard me");await name.press("Escape");await name.press("Tab");
  await page.waitForTimeout(350);
  await expect(page.getByTestId("commits")).toHaveText("commits 1");
  await expect(page.getByTestId("markers-state")).not.toContainText("Discard me");
});
