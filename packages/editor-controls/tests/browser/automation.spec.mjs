import {expect,test} from "playwright/test";

// Automation lane and mode picker in React Native Web: real pointer drags,
// keys and clicks against the controlled components, with the fixture
// standing in for the Cadence engine. Each accepted op logs one line.
const log=page=>page.getByTestId("log");
const lines=async page=>(await log(page).innerText()).split("\n").filter(Boolean);
const gainLane=page=>page.getByTestId("gain");
const point=(page,n,lane="gain")=>page.getByTestId(lane).getByRole("slider",{name:"Point "+n,exact:true});

async function center(locator){
  await locator.scrollIntoViewIfNeeded();
  const b=await locator.boundingBox();
  return {x:b.x+b.width/2,y:b.y+b.height/2};
}

test.beforeEach(async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/automation");
});

test("dragging a point commits once, snapped and clamped between neighbours",async({page})=>{
  const {x,y}=await center(point(page,3));
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+10,y+10,{steps:4});
  await page.mouse.move(x+24,y+30,{steps:4});
  await expect(log(page)).toHaveText("");
  await expect(gainLane(page).getByText(/^Point 3: Bar 2 beat 1\.25,/)).toBeVisible();
  await page.mouse.up();
  await expect(log(page)).toHaveText(/^move gain 2 4080 0\.\d{3}$/);
  // Far past the next point (5760): stays strictly before it.
  const p3=await center(point(page,3));
  await page.mouse.move(p3.x,p3.y);await page.mouse.down();
  await page.mouse.move(p3.x+400,p3.y,{steps:8});
  await page.mouse.up();
  expect(await lines(page)).toHaveLength(2);
  expect((await lines(page))[1]).toMatch(/^move gain 2 5520 /);
});

test("Escape mid-drag restores the point without a commit",async({page})=>{
  const target=point(page,2);
  const before=await target.getAttribute("aria-valuetext");
  const {x,y}=await center(target);
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+30,y+40,{steps:6});
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(log(page)).toHaveText("");
  await expect(target).toHaveAttribute("aria-valuetext",before);
  await expect(target).toHaveAttribute("aria-valuetext","Bar 1 beat 3, 0.0 dB");
});

test("keyboard: arrows step value and time, Delete removes",async({page})=>{
  const p=point(page,2);
  await p.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("PageDown");
  await expect(log(page)).toHaveText("move gain 1 1920 0.891\nmove gain 1 2160 0.891\nmove gain 1 2160 0.447");
  await expect(p).toHaveAttribute("aria-valuetext","Bar 1 beat 3.25, -7.0 dB");
  await page.keyboard.press("Shift+ArrowRight");
  expect((await lines(page)).at(-1)).toBe("move gain 1 3839 0.447");
  await page.keyboard.press("Delete");
  expect((await lines(page)).at(-1)).toBe("remove gain 1");
  await expect(gainLane(page).getByRole("slider")).toHaveCount(3);
});

test("click on empty lane adds a snapped point; Add point uses the cursor",async({page})=>{
  const lane=page.getByTestId("pan");
  await expect(lane.getByText("No points. Click the lane to add one")).toBeVisible();
  await expect(lane.getByText("Automation off: the pan control sets the position")).toBeVisible();
  const grid=await lane.getByRole("slider").count();
  expect(grid).toBe(0);
  // The C gridline is the lane's vertical middle; aim 1.5 beats in.
  const p1=await center(point(page,1));
  const add=lane.getByRole("button",{name:"Add point at Bar 1 beat 1"});
  await add.click();
  await expect(log(page)).toHaveText("add pan 0 0.000");
  const first=await center(point(page,1,"pan"));
  await page.mouse.click(first.x+144,first.y-30);
  expect((await lines(page)).at(-1)).toMatch(/^add pan 1440 0\.\d{3}$/);
  await expect(add).toBeDisabled();
  await expect(lane.getByText(/No points/)).toHaveCount(0);
  expect(p1).toBeTruthy();
  // Gain lane: the button adds on the line at its cursor (bar 1 beat 2).
  await gainLane(page).getByRole("button",{name:"Add point at Bar 1 beat 2"}).click();
  expect((await lines(page)).at(-1)).toBe("add gain 960 0.851");
});

test("mode picker is a radio group; arrows move and commit",async({page})=>{
  const group=page.getByRole("radiogroup",{name:"Vocal volume mode"});
  await expect(group.getByRole("radio")).toHaveCount(6);
  await expect(group.getByRole("radio",{name:"Read"})).toBeChecked();
  await group.getByRole("radio",{name:"Off"}).click();
  await expect(log(page)).toHaveText("mode gain off");
  await expect(gainLane(page).getByText("Automation off: the fader sets the level")).toBeVisible();
  await group.getByRole("radio",{name:"Off"}).focus();
  await page.keyboard.press("ArrowRight");
  await expect(log(page)).toHaveText("mode gain off\nmode gain read");
  await expect(group.getByRole("radio",{name:"Read"})).toBeFocused();
  for(const m of ["Write","Touch","Latch","Trim"]){await expect(group.getByRole("radio",{name:m})).toBeDisabled();await expect(gainLane(page).getByText(m+": Not supported by the current audio host")).toBeVisible();}
});

test("disabled lane and picker ignore input",async({page})=>{
  const lane=page.getByTestId("bass");
  await lane.getByRole("radio",{name:"Read"}).click({force:true});
  await lane.getByRole("button",{name:/^Add point/}).click({force:true});
  const {x,y}=await center(point(page,1,"bass"));
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+20,{steps:4});await page.mouse.up();
  await expect(log(page)).toHaveText("");
});

test("a rejected commit leaves the committed point on screen",async({page})=>{
  await page.goto("/automation?reject=1");
  const p=point(page,2);
  const before=await p.getAttribute("aria-valuetext");
  const {x,y}=await center(p);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y+30,{steps:4});await page.mouse.up();
  await expect(p).toHaveAttribute("aria-valuetext",before);
  await expect(page.getByTestId("gain").getByRole("slider")).toHaveCount(4);
});

test("targets are at least 44px and the phone page never scrolls sideways",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/automation");
  const targets=[...await page.getByRole("slider").all(),...await page.getByRole("radio").all(),
    ...await page.getByRole("button",{name:/^Add point/}).all()];
  expect(targets.length).toBe(6+18+3);
  for(const t of targets){const b=await t.boundingBox();expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);}
  const over=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});

test("RTL mirrors the axis gutter but keeps time left to right",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/automation?dir=rtl");
  const a=await point(page,1).boundingBox();
  const b=await point(page,2).boundingBox();
  expect(b.x,"later point is further right").toBeGreaterThan(a.x);
  const label=await gainLane(page).getByText("-inf",{exact:true}).boundingBox();
  expect(label.x,"axis labels sit on the right in RTL").toBeGreaterThan(a.x);
});
