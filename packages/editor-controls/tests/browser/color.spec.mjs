import {test,expect} from "playwright/test";

const at=async(locator,fx,fy)=>{const b=await locator.boundingBox();return {x:b.x+b.width*fx,y:b.y+b.height*fy};};
async function drag(page,from,steps){
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  for(const p of steps)await page.mouse.move(p.x,p.y,{steps:4});
}
const commits=page=>page.getByTestId("commits");
const hsv=page=>page.getByTestId("hsv");

test("disc drag previews, commits once, and the center keeps the hue",async({page})=>{
  await page.goto("/color?mode=compact");
  const disc=page.getByRole("slider",{name:"Hue and saturation"});
  const right=await at(disc,0.99,0.5);
  await drag(page,await at(disc,0.75,0.5),[right]);
  await expect(hsv(page)).toHaveText(/^hsv 0 9\d 82 85$/);
  await expect(commits(page)).toHaveText("commits 0");
  await page.mouse.up();
  await expect(commits(page)).toHaveText("commits 1");
  // Up to hue 90, then through the exact center: saturation 0 keeps the
  // in-drag hue 90 instead of jumping back to the committed 0.
  await drag(page,await at(disc,0.5,0.25),[await at(disc,0.5,0.5)]);
  await expect(hsv(page)).toHaveText(/^hsv 90 0 /);
  await page.mouse.up();
  await expect(commits(page)).toHaveText("commits 2");
});

test("Escape mid-drag on the disc restores the color without a commit",async({page})=>{
  await page.goto("/color?mode=compact");
  const disc=page.getByRole("slider",{name:"Hue and saturation"});
  await disc.focus();
  await drag(page,await at(disc,0.2,0.2),[await at(disc,0.8,0.3)]);
  await expect(hsv(page)).not.toHaveText("hsv 217 72 82 85");
  await page.keyboard.press("Escape");
  await expect(hsv(page)).toHaveText("hsv 217 72 82 85");
  await page.mouse.up();
  await expect(commits(page)).toHaveText("commits 0");
  // Keyboard: Right turns the hue 5 degrees and commits.
  await disc.focus();
  await page.keyboard.press("ArrowRight");
  await expect(hsv(page)).toHaveText("hsv 222 72 82 85");
  await expect(commits(page)).toHaveText("commits 1");
});

test("brightness track drags and steps from the keyboard",async({page})=>{
  await page.goto("/color?mode=compact");
  const track=page.getByRole("slider",{name:"Brightness"});
  await expect(track).toHaveAttribute("aria-valuenow","82");
  await drag(page,await at(track,0.5,0.5),[await at(track,0.04,0.5)]);
  await page.mouse.up();
  await expect(hsv(page)).toHaveText("hsv 217 72 0 85");
  await expect(commits(page)).toHaveText("commits 1");
  await track.focus();
  await page.keyboard.press("PageUp");
  await expect(hsv(page)).toHaveText("hsv 217 72 10 85");
});

test("hue ring jumps on the ring and slows inside the hole",async({page})=>{
  await page.goto("/color?mode=classic");
  const wheel=page.getByRole("slider",{name:"Hue",exact:true});
  await drag(page,await at(wheel,0.96,0.5),[await at(wheel,0.97,0.5)]);
  await expect(page.getByText("Hue 0°",{exact:true})).toBeVisible();
  // Into the hole at the same angle: fine mode, no jump.
  await page.mouse.move(...Object.values(await at(wheel,0.62,0.5)),{steps:4});
  await expect(page.getByText("Hue 0° (fine)")).toBeVisible();
  // A quarter turn inside the hole moves the hue a fifth as far.
  await page.mouse.move(...Object.values(await at(wheel,0.5,0.38)),{steps:6});
  await expect(page.getByText(/^Hue 1[78]° \(fine\)$/)).toBeVisible();
  await page.mouse.up();
  await expect(commits(page)).toHaveText("commits 1");
  await wheel.focus();
  await page.keyboard.press("ArrowUp");
  await expect(wheel).toHaveAttribute("aria-valuenow",/^1[89]$/);
});

test("opacity accepts typed entry and keys, and rejects out-of-range text",async({page})=>{
  await page.goto("/color?mode=classic");
  const input=page.getByLabel("Opacity percent");
  await input.fill("40");await input.press("Enter");
  await expect(hsv(page)).toHaveText("hsv 217 72 82 40");
  await input.fill("140");await input.press("Enter");
  await expect(page.getByText("Enter a percent from 0 to 100.")).toBeVisible();
  await expect(commits(page)).toHaveText("commits 1");
  const track=page.getByRole("slider",{name:"Opacity"});
  await track.focus();
  await page.keyboard.press("ArrowRight");
  await expect(hsv(page)).toHaveText("hsv 217 72 82 41");
  await page.keyboard.press("End");
  await expect(hsv(page)).toHaveText("hsv 217 72 82 100");
});

test("channel fields commit one channel and keep the rest",async({page})=>{
  await page.goto("/color");
  const light=page.getByLabel("Lightness",{exact:true});
  await light.fill("30");await light.press("Enter");
  await expect(commits(page)).toHaveText("commits 1");
  await expect(page.getByRole("textbox",{name:"Hue",exact:true})).toHaveValue("217");
  await expect(light).toHaveValue("30");
  const sat=page.getByLabel("Saturation",{exact:true});
  await sat.fill("300");await sat.press("Enter");
  await expect(page.getByText("Enter saturation from 0 to 100 percent.")).toBeVisible();
  await expect(commits(page)).toHaveText("commits 1");
  await page.getByRole("radio",{name:"RGB"}).click();
  await expect(page.getByLabel("Red",{exact:true})).toBeVisible();
  const hex=page.getByLabel("Hex",{exact:true});
  await hex.fill("#00ff00");await hex.press("Enter");
  await expect(page.getByTestId("hex")).toHaveText("hex #00FF00D9");
});

test("foreground and background swap and reset",async({page})=>{
  await page.goto("/color");
  await page.getByTestId("chips-swap").click();
  await expect(page.getByTestId("hex")).toHaveText("hex #FAF8F0FF");
  await page.getByTestId("chips-reset").click();
  await expect(page.getByTestId("hex")).toHaveText("hex #000000FF");
  await expect(page.getByTestId("chips-reset")).toBeDisabled();
  await page.getByRole("radio",{name:/^Background/}).click();
  await expect(page.getByTestId("hex")).toHaveText("hex #FFFFFFFF");
});

test("swatch search, selection, empty result and recent colors",async({page})=>{
  await page.goto("/color?mode=palettes");
  await page.getByLabel("Search swatches").fill("moss");
  await expect(page.getByRole("button",{name:/^Moss/})).toBeVisible();
  await expect(page.getByRole("button",{name:/^Harbor/})).toHaveCount(0);
  await page.getByRole("button",{name:/^Moss/}).click();
  await expect(page.getByTestId("recent")).toHaveText("recent #4A7034FF");
  await page.getByLabel("Search swatches").fill("zzz");
  await expect(page.getByText("No swatches match “zzz”.")).toBeVisible();
  await page.getByRole("button",{name:"Clear search"}).click();
  const first=page.getByRole("button",{name:/^Harbor/});
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button",{name:/^Moss/})).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("button",{name:/^Bone/})).toBeFocused();
});

test("harmony rule and pick commit, contrast is spelled out",async({page})=>{
  await page.goto("/color");
  await page.getByRole("radio",{name:"Complementary",exact:true}).click();
  const comp=page.getByRole("button",{name:/^Use #/});
  await expect(comp).toHaveCount(1);
  await expect(page.getByText(/^Base on background: \d+\.\d+:1, /)).toBeVisible();
  await comp.click();
  await expect(commits(page)).toHaveText("commits 1");
  await expect(hsv(page)).toHaveText(/^hsv 37 /);
});

test("palette undocks past the threshold, moves, avoids the hinge and docks",async({page})=>{
  await page.setViewportSize({width:1000,height:900});
  await page.goto("/color?hinge=1&mode=classic");
  const handle=page.getByLabel("Undock colors palette");
  const box=await handle.boundingBox();
  const c={x:box.x+box.width/2,y:box.y+box.height/2};
  await drag(page,c,[{x:c.x+10,y:c.y+12}]);
  await page.mouse.up();
  await expect(page.getByTestId("docked")).toHaveText(/^docked/);
  await drag(page,c,[{x:c.x+40,y:c.y+20},{x:c.x+380,y:c.y+60}]);
  await page.mouse.up();
  await expect(page.getByTestId("docked")).toHaveText(/^floating /);
  const pos=(await page.getByTestId("docked").textContent()).match(/(\d+),(\d+)/).slice(1).map(Number);
  const hinge=await page.getByTestId("hinge").boundingBox();
  const panel=await page.getByTestId("palette").boundingBox();
  expect(panel.x+panel.width<=hinge.x+0.5||panel.x>=hinge.x+hinge.width-0.5).toBe(true);
  expect(pos[0]).toBeGreaterThan(0);
  // Keyboard: arrow nudges, Enter docks.
  const move=page.getByTestId("palette-handle");
  await move.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("docked")).toHaveText(`floating ${pos[0]},${pos[1]+8}`);
  await page.getByTestId("palette-dock").click();
  await expect(page.getByTestId("docked")).toHaveText(/^docked/);
  // The hue edited while floating is still the color after docking.
  await expect(hsv(page)).toHaveText("hsv 217 72 82 85");
});

test("a floating drag moves the palette exactly as far as the pointer",async({page})=>{
  await page.setViewportSize({width:1000,height:900});
  await page.goto("/color?float=1&mode=classic");
  await expect(page.getByTestId("docked")).toHaveText("floating 24,24");
  const handle=page.getByLabel("Move colors palette");
  const b=await handle.boundingBox();
  const c={x:b.x+b.width/2,y:b.y+b.height/2};
  const before=await page.getByTestId("palette").boundingBox();
  await drag(page,c,[{x:c.x+20,y:c.y+10},{x:c.x+60,y:c.y+30},{x:c.x+100,y:c.y+50}]);
  const during=await page.getByTestId("palette").boundingBox();
  expect(Math.round(during.x-before.x)).toBe(100);
  expect(Math.round(during.y-before.y)).toBe(50);
  await page.mouse.up();
  await expect(page.getByTestId("docked")).toHaveText("floating 124,74");
});


test("injected color renderer receives live brightness and retains the disc input owner",async({page})=>{
 await page.goto('/color?mode=compact&renderer=1');
 const rendered=page.getByTestId('managed-disc');
 await expect(rendered).toContainText('Managed brightness 0.82');
 const brightness=page.getByRole('slider',{name:'Brightness',exact:true});
 await brightness.focus();
 await page.keyboard.press('ArrowRight');
 await expect(commits(page)).toHaveText('commits 1');
 await expect(rendered).toContainText('Managed brightness 0.83');
 const disc=page.getByRole('slider',{name:'Hue and saturation'});
 await disc.focus();await page.keyboard.press('ArrowRight');
 await expect(commits(page)).toHaveText('commits 2');
 await expect(hsv(page)).toHaveText('hsv 222 72 83 85');
});


test("harmony sample paints the same alpha used by its contrast calculation",async({page})=>{
 await page.goto('/color?mode=compact');
 await expect(page.getByText('Aa Sample heading',{exact:true})).toHaveCSS('color',/rgba\(.+, 0\.85\)/);
});
