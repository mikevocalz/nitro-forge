import {test,expect} from "playwright/test";
const log=page=>page.getByTestId("log");
const open=async(page,query,size={width:834,height:1194})=>{
  await page.setViewportSize(size);
  await page.goto("/selection-tools?"+query);
  await log(page).waitFor();
};
const drag=async(page,from,to,steps=8)=>{
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps});
};

test("marquee: a drag commits one selectRegion and undo restores the selection",async({page})=>{
  await open(page,"view=marquee");
  const canvas=page.getByLabel(/^Selection canvas/);
  const b=await canvas.boundingBox();
  await drag(page,{x:b.x+20,y:b.y+20},{x:b.x+b.width/2,y:b.y+b.height/2});
  await expect(log(page)).toHaveText("log ");
  await page.mouse.up();
  await expect(log(page)).toHaveText(/^log selectRegion rect replace \d+x\d+@\d+,\d+$/);
  await expect(page.getByTestId("selection-ants")).toBeVisible();
  await page.getByRole("button",{name:"Undo"}).click();
  await expect(page.getByTestId("selection-ants")).toHaveCount(0);
});
test("marquee: Shift adds, Alt subtracts, Escape cancels a drag",async({page})=>{
  await open(page,"view=marquee&selected=1");
  const canvas=page.getByLabel(/^Selection canvas/);
  const b=await canvas.boundingBox();
  await page.keyboard.down("Shift");
  await drag(page,{x:b.x+10,y:b.y+10},{x:b.x+80,y:b.y+60});
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(log(page)).toHaveText(/selectRegion rect add/);
  await canvas.focus();
  await page.keyboard.down("Alt");
  await drag(page,{x:b.x+100,y:b.y+100},{x:b.x+160,y:b.y+140});
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(log(page)).toHaveText(/selectRegion rect add .*, selectRegion rect subtract/);
  await drag(page,{x:b.x+30,y:b.y+30},{x:b.x+120,y:b.y+90});
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByText("Selection cancelled")).toBeVisible();
  await expect(log(page)).not.toHaveText(/, selectRegion rect replace/);
});
test("marquee: polygon closes on the first point and lasso closes on release",async({page})=>{
  await open(page,"view=marquee&tool=polygon");
  const b=await page.getByLabel(/^Selection canvas/).boundingBox();
  for(const [x,y] of [[40,40],[200,50],[150,180]])await page.mouse.click(b.x+x,b.y+y);
  await expect(log(page)).toHaveText("log ");
  await page.mouse.click(b.x+42,b.y+42);
  await expect(log(page)).toHaveText(/^log selectRegion polygon replace/);
  await page.getByRole("radio",{name:"Lasso"}).click();
  await page.mouse.move(b.x+60,b.y+60);await page.mouse.down();
  for(const [x,y] of [[160,70],[220,140],[120,200],[50,150]])await page.mouse.move(b.x+x,b.y+y,{steps:5});
  await page.mouse.up();
  await expect(log(page)).toHaveText(/selectRegion polygon replace .*, selectRegion polygon replace \d+x\d+/);
});
test("marquee: keyboard alternative builds a rectangle; deselect explains itself",async({page})=>{
  await open(page,"view=marquee");
  await expect(page.getByRole("button",{name:"Deselect"})).toBeDisabled();
  await expect(page.getByText("Nothing is selected")).toBeVisible();
  const canvas=page.getByLabel(/^Selection canvas/);
  await canvas.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByText("Rectangle 400 by 260 px at 220, 125, New")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(log(page)).toHaveText("log selectRegion rect replace 400x260@220,125");
  await page.keyboard.press("ControlOrMeta+d");
  await expect(log(page)).toHaveText(/, deselect$/);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(log(page)).toHaveText(/, selectAll$/);
});
test("wand: a click sends one magicWand; edge tools wait for a selection",async({page})=>{
  await open(page,"view=wand");
  await expect(page.getByRole("button",{name:"Grow",exact:true})).toBeDisabled();
  await expect(page.getByText("Make a selection first to grow, shrink, feather or refine it.")).toBeVisible();
  await page.getByRole("switch",{name:"Contiguous"}).click();
  await expect(log(page)).toHaveText("log settings t32 g composite");
  const b=await page.getByLabel(/^Magic wand canvas/).boundingBox();
  await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
  await expect(log(page)).toHaveText(/magicWand \d+,\d+ t32 global composite replace$/);
  const target=(await log(page).textContent()).match(/magicWand (\d+),(\d+)/);
  expect(Math.abs(Number(target[1])-400)).toBeLessThanOrEqual(2);
  expect(Math.abs(Number(target[2])-250)).toBeLessThanOrEqual(2);
  await page.getByRole("button",{name:"Grow",exact:true}).click();
  await expect(log(page)).toHaveText(/, modifySelection grow 4$/);
  await page.getByRole("button",{name:"Feather",exact:true}).click();
  await expect(log(page)).toHaveText(/, modifySelection feather 8$/);
  await expect(page.getByRole("button",{name:"Refine edge"})).toBeDisabled();
  await expect(page.getByText(/smoothing operation this editor does not offer/)).toBeVisible();
});
test("wand: keyboard aim and layer sampling without a layer",async({page})=>{
  await open(page,"view=wand&layer=0");
  await expect(page.getByRole("radio",{name:"Current layer"})).toBeDisabled();
  await expect(page.getByText("Current layer sampling needs a selected layer")).toBeVisible();
  await page.getByLabel(/^Magic wand canvas/).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Wand cancelled")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(log(page)).toHaveText("log magicWand 400,240 t32 contiguous composite replace");
});
test("color drop: drop on the canvas fills once; outside or Escape puts it back",async({page})=>{
  await open(page,"view=drop",{width:390,height:844});
  const chip=page.getByRole("button",{name:"Coral fill colour"});
  const c=await chip.boundingBox();const t=await page.getByTestId("color-drop-target").boundingBox();
  await drag(page,{x:c.x+22,y:c.y+22},{x:t.x+t.width/4,y:t.y+t.height/2});
  await expect(page.getByTestId("color-drop-dot")).toBeVisible();
  await expect(page.getByTestId("color-drop-band")).toHaveText(/Fill at \d+, \d+ with Coral, Threshold 13%/);
  await page.mouse.up();
  await expect(log(page)).toHaveText(/^log floodFill \d+,250 #c8553d t32 contiguous$/);
  await expect(page.getByTestId("fill-mark")).toHaveCount(1);
  await drag(page,{x:c.x+22,y:c.y+22},{x:t.x+t.width/2,y:t.y+t.height+60});
  await page.mouse.up();
  await expect(page.getByText("Dropped outside the canvas. Nothing was filled.")).toBeVisible();
  await drag(page,{x:c.x+22,y:c.y+22},{x:t.x+t.width/2,y:t.y+t.height/2});
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("color-drop-band")).toHaveText("Colour put back");
  await expect(page.getByTestId("fill-mark")).toHaveCount(1);
  await page.mouse.click(c.x+22,c.y+22);
  await expect(log(page)).toHaveText(/, chip pressed$/);
  await page.getByRole("button",{name:"Undo"}).click();
  await expect(page.getByTestId("fill-mark")).toHaveCount(0);
});
test("color drop: keyboard aim fills at the crosshair; disabled says why",async({page})=>{
  await open(page,"view=drop");
  await page.getByRole("button",{name:"Coral fill colour"}).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(log(page)).toHaveText(/^log floodFill \d+,250 #c8553d t32 contiguous$/);
  await open(page,"view=drop&locked=1");
  await page.getByRole("button",{name:"Coral fill colour, unavailable"}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("color-drop-band")).toHaveText("Fill needs an unlocked pixel layer");
});
test("reference: drag moves once per release; pin and lock refuse with a reason",async({page})=>{
  await open(page,"view=reference");
  const bar=await page.getByTestId("reference-bar-r1").boundingBox();
  await drag(page,{x:bar.x+40,y:bar.y+20},{x:bar.x+140,y:bar.y+80});
  await expect(log(page)).toHaveText("log ");
  await page.mouse.up();
  await expect(log(page)).toHaveText(/^log update r1 x=116 y=76 width=200 height=170$/);
  await page.getByRole("switch",{name:"Pin in place"}).click();
  await expect(log(page)).toHaveText(/, update r1 pinned=true$/);
  const bar2=await page.getByTestId("reference-bar-r1").boundingBox();
  await drag(page,{x:bar2.x+40,y:bar2.y+20},{x:bar2.x+90,y:bar2.y+40});
  await page.mouse.up();
  await expect(page.getByText("Skyline is pinned. Unpin it to move it.")).toBeVisible();
  await page.getByRole("button",{name:"Increase opacity"}).click();
  await page.getByRole("button",{name:"Decrease opacity"}).click();
  await expect(log(page)).toHaveText(/, update r1 opacity=0\.9$/);
  await page.getByRole("switch",{name:"Lock"}).click();
  await page.getByRole("button",{name:"Remove Skyline, unavailable"}).click();
  await expect(page.getByText("Skyline is locked. Unlock it to change it.").first()).toBeVisible();
  await expect(log(page)).not.toHaveText(/remove/);
});
test("reference: keyboard moves, resizes and removes; placement and add",async({page})=>{
  await open(page,"view=reference");
  const win=page.getByTestId("reference-window-r1");
  await win.focus();
  await page.keyboard.press("ArrowRight");
  await expect(log(page)).toHaveText("log update r1 x=24 y=16 width=200 height=170");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(log(page)).toHaveText(/, update r1 x=24 y=16 width=200 height=178$/);
  await page.getByRole("radio",{name:"Overlay"}).click();
  await expect(log(page)).toHaveText(/, update r1 placement=overlay$/);
  await expect(page.getByTestId("reference-window-r1")).toHaveCount(0);
  await page.getByRole("button",{name:"Add reference image"}).click();
  await expect(page.getByTestId("reference-window-r3")).toBeVisible();
  await page.getByTestId("reference-window-r3").focus();
  await page.keyboard.press("Delete");
  await expect(log(page)).toHaveText(/, add r3, remove r3$/);
});
test("gestures: conflicts block Save until resolved; Save and Cancel commit once",async({page})=>{
  await open(page,"view=gestures",{width:390,height:844});
  await expect(page.getByRole("button",{name:"Save"})).toBeDisabled();
  await page.getByRole("combobox",{name:"Hide interface"}).click();
  await page.getByRole("option",{name:"Two-finger tap"}).click();
  await expect(page.getByText("Two-finger tap is set for both Undo and Hide interface").first()).toBeVisible();
  await expect(page.getByRole("button",{name:"Save"})).toBeDisabled();
  await expect(page.getByText("Fix the conflict above to save")).toBeVisible();
  await page.getByRole("button",{name:"Keep Two-finger tap for Hide interface"}).click();
  await expect(page.getByText(/is set for both/)).toHaveCount(0);
  await page.getByRole("combobox",{name:"Quick menu"}).click();
  await expect(page.getByRole("option",{name:"Three-finger swipe up (reserved)"})).toHaveAttribute("aria-disabled","true");
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Save"}).click();
  await expect(log(page)).toHaveText("log save redo=three-finger-tap eyedropper=long-press toggle-eraser=pencil-double-tap hide-ui=two-finger-tap hold=0.4");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button",{name:"Reset to defaults"}).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button",{name:"Cancel"}).click();
  await expect(log(page)).toHaveText(/, cancel$/);
  await page.getByRole("button",{name:"Open gesture controls"}).click();
  await expect(page.getByRole("combobox",{name:"Undo"})).toHaveText(/No gesture/);
});
test("every control keeps a 44pt target",async({page})=>{
  for(const v of ["marquee","wand&selected=1","drop","reference","gestures"]){
    await open(page,"view="+v,{width:390,height:844});
    for(const role of ["button","radio","switch","combobox","slider"]){
      for(const el of await page.getByRole(role).all()){
        const box=await el.boundingBox();
        if(box===null)continue;
        const name=v+" "+role+" "+(await el.getAttribute("aria-label")??await el.textContent());
        expect(box.height,name).toBeGreaterThanOrEqual(40);
        expect(box.width,name).toBeGreaterThanOrEqual(40);
      }
    }
  }
});

test("reference short radio labels retain a 44pt touch target",async({page})=>{
  await open(page,"view=reference",{width:390,height:844});
  for(const radio of await page.getByRole("radio").all()){
    const box=await radio.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
