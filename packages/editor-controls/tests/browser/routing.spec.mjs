import {expect,test} from "playwright/test";

// Routing matrix, insert rack and preset browser in React Native Web: real
// pointer drags, keys and clicks, the fixture standing in for the engine.
const log=page=>page.getByTestId("log");
const lines=async page=>(await log(page).innerText()).split("\n").filter(Boolean);
const tablet={width:834,height:1194},phone={width:390,height:844};
const outputs=(page,name)=>page.getByRole("radiogroup",{name:name+" output"});

async function drag(page,locator,dx,{escape=false}={}){
  await locator.scrollIntoViewIfNeeded();
  const box=await locator.boundingBox();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+dx/2,y,{steps:4});
  if(escape)await page.keyboard.press("Escape");
  await page.mouse.move(x+dx,y,{steps:4});
  await page.mouse.up();
}
async function noPageErrors(page){const errors=[];page.on("pageerror",e=>errors.push(e.message));return errors;}

test("matrix grid: output radios commit once per press and per arrow key",async({page})=>{
  const errors=await noPageErrors(page);
  await page.setViewportSize(tablet);
  await page.goto("/routing");
  await expect(page.getByText("Send to Reverb")).toBeVisible();
  await outputs(page,"Lead vocal").getByRole("radio",{name:"Drum bus"}).click();
  await expect(log(page)).toHaveText("output 1 drm");
  await expect(outputs(page,"Lead vocal").getByRole("radio",{name:"Drum bus"})).toHaveAttribute("aria-checked","true");
  const master=outputs(page,"Bass").getByRole("radio",{name:"Master"});
  await master.focus();
  await page.keyboard.press("ArrowRight");
  await expect(log(page)).toContainText("output 3 rev");
  await expect(outputs(page,"Bass").getByRole("radio",{name:"Reverb"})).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(log(page)).toContainText("output 3 rev\noutput 3 null");
  expect(await lines(page)).toHaveLength(3);
  expect(errors).toEqual([]);
});

test("send slider: drag commits once, Escape cancels, keys step, Delete removes, Add adds",async({page})=>{
  await page.setViewportSize(tablet);
  await page.goto("/routing");
  const send=page.getByRole("slider",{name:"Lead vocal send to Reverb"});
  await expect(send).toHaveAttribute("aria-valuenow","35");
  await drag(page,send,40);
  await expect(log(page)).toHaveText(/^send 1 rev 0\.\d+$/);
  const after=Number((await lines(page))[0].split(" ")[3]);
  expect(after).toBeGreaterThan(0.35);
  await drag(page,send,-60,{escape:true});
  expect(await lines(page),"cancelled drag does not commit").toHaveLength(1);
  await expect(send).toHaveAttribute("aria-valuenow",String(Math.round(after*100)));
  await send.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("PageUp");
  await page.keyboard.press("End");
  await expect(log(page)).toContainText("send 1 rev 0\nsend 1 rev 0.05\nsend 1 rev 0.25\nsend 1 rev 1");
  await page.keyboard.press("Delete");
  await expect(log(page)).toContainText("unsend 1 rev");
  await page.getByRole("button",{name:"Add Drums send to Reverb"}).click();
  await expect(log(page)).toContainText("send 2 rev 0.5");
  await page.getByRole("button",{name:"Remove Bass send to Reverb"}).click();
  await expect(log(page)).toContainText("unsend 3 rev");
});

test("matrix measures its container: a narrow pane gets cards on a tablet",async({page})=>{
  await page.setViewportSize(tablet);
  await page.goto("/routing?narrow=1");
  await expect(page.getByRole("heading",{name:"Lead vocal",level:3,exact:true})).toBeVisible();
  await expect(page.getByText("Send to Reverb")).toHaveCount(0);
  await outputs(page,"Drums").getByRole("radio",{name:"Master"}).click();
  await expect(log(page)).toHaveText("output 2 null");
});

test("phone: cards, 44 px targets, no horizontal page scroll",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/routing");
  await expect(page.getByRole("heading",{name:"Drums",level:3})).toBeVisible();
  const controls=page.locator("[role=radio],[role=slider],[role=button],input");
  const n=await controls.count();
  expect(n).toBeGreaterThan(20);
  for(let i=0;i<n;i++){
    const c=controls.nth(i);
    if(!(await c.isVisible()))continue;
    const box=await c.boundingBox();
    const name=await c.getAttribute("aria-label");
    expect(box.height,`${name} height`).toBeGreaterThanOrEqual(44);
    expect(box.width,`${name} width`).toBeGreaterThanOrEqual(44);
  }
  const over=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(over,"no horizontal page scroll").toBeLessThanOrEqual(0);
});

test("empty states: no tracks, no buses with an exit",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/routing?empty=1");
  await expect(page.getByText("No tracks to route")).toBeVisible();
  await expect(page.getByText("No effects yet")).toBeVisible();
  await page.goto("/routing?nobus=1");
  await expect(page.getByText("No buses yet")).toBeVisible();
  await page.getByRole("button",{name:"Add bus"}).click();
  await expect(log(page)).toHaveText("add bus");
});

test("rejected commits leave the committed routing on screen",async({page})=>{
  const errors=await noPageErrors(page);
  await page.setViewportSize(tablet);
  await page.goto("/routing?reject=1");
  await outputs(page,"Lead vocal").getByRole("radio",{name:"Drum bus"}).click();
  await expect(log(page)).toHaveText("output 1 drm\nrejected");
  await expect(outputs(page,"Lead vocal").getByRole("radio",{name:"Master"})).toHaveAttribute("aria-checked","true");
  await page.getByRole("button",{name:"Bypass EQ in slot 1"}).click();
  await expect(log(page)).toContainText("bypass s0 true\nrejected");
  await expect(page.getByRole("button",{name:"Bypass EQ in slot 1"})).toHaveAttribute("aria-pressed","false");
  expect(errors).toEqual([]);
});

test("disabled: every control refuses input",async({page})=>{
  await page.setViewportSize(tablet);
  await page.goto("/routing?disabled=1");
  await outputs(page,"Lead vocal").getByRole("radio",{name:"Drum bus"}).click({force:true});
  await page.getByRole("button",{name:"Bypass EQ in slot 1"}).click({force:true});
  await expect(page.getByRole("button",{name:"Add effect to Lead vocal"})).toBeDisabled();
  await expect(log(page)).toHaveText("");
});

test("insert rack: bypass, move by button and keys, remove, add from the picker",async({page})=>{
  await page.setViewportSize(tablet);
  await page.goto("/routing");
  const bypass=page.getByRole("button",{name:"Bypass Compressor in slot 2"});
  await expect(bypass).toHaveAttribute("aria-pressed","true");
  await bypass.click();
  await expect(log(page)).toHaveText("bypass s1 false");
  await expect(page.getByRole("button",{name:"Move EQ earlier"})).toBeDisabled();
  await page.getByRole("button",{name:"Move EQ later"}).click();
  await expect(log(page)).toContainText("move s0 1");
  const gain=page.getByRole("button",{name:"Slot 3 of 3, Gain"});
  await gain.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(log(page)).toContainText("move s2 1");
  await page.getByRole("button",{name:/^Slot 1 of 3, Compressor/}).focus();
  await page.keyboard.press("Delete");
  await expect(log(page)).toContainText("remove s1");
  const add=page.getByRole("button",{name:"Add effect to Lead vocal"});
  await add.click();
  await expect(add).toHaveAttribute("aria-expanded","true");
  await page.getByRole("button",{name:"Add Compressor"}).click();
  await expect(log(page)).toContainText("add compressor");
  await expect(page.getByRole("button",{name:"Add Compressor"})).toHaveCount(0);
  expect(await lines(page)).toHaveLength(5);
});

test("insert rack: a full chain disables Add and says why",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/routing?full=1");
  await expect(page.getByText("8 of 8")).toBeVisible();
  const add=page.getByRole("button",{name:"Add effect to Lead vocal"});
  await expect(add).toBeDisabled();
  await expect(add).toHaveAccessibleDescription("All 8 slots are in use. Remove an effect to add another.");
  await expect(page.getByText("All 8 slots are in use. Remove an effect to add another.")).toBeVisible();
});

test("preset browser: search filters, radio applies, arrows apply, empty result clears",async({page})=>{
  await page.setViewportSize(tablet);
  await page.goto("/routing");
  await expect(page.getByRole("radio",{name:"Vocal presence"})).toHaveAttribute("aria-checked","true");
  const search=page.getByLabel("Search EQ presets");
  await search.fill("bass");
  await expect(page.getByRole("radiogroup",{name:"EQ presets"}).getByRole("radio")).toHaveCount(1);
  await page.getByRole("radio",{name:"Bass tighten"}).click();
  await expect(log(page)).toHaveText("preset s0 bass-tighten");
  await search.fill("zzz");
  await expect(page.getByText('No EQ presets match "zzz".')).toBeVisible();
  await page.getByRole("button",{name:"Clear search"}).click();
  await expect(search).toHaveValue("");
  await page.getByRole("radio",{name:"Bass tighten"}).focus();
  await page.keyboard.press("ArrowDown");
  await expect(log(page)).toContainText("preset s0 telephone");
  await expect(page.getByRole("radio",{name:"Telephone"})).toBeFocused();
  await page.getByRole("button",{name:/^Slot 2 of 3, Compressor/}).click();
  await expect(page.getByRole("heading",{name:"Compressor presets"})).toBeVisible();
  await expect(search).toHaveCount(0);
  expect((await page.getByLabel("Search Compressor presets").boundingBox()).height).toBeGreaterThanOrEqual(44);
});

test("preset browser: loading and error text, retry",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/routing?presets=loading");
  await expect(page.getByText("Loading EQ presets…")).toBeVisible();
  await expect(page.getByRole("radio",{name:"Flat"})).toHaveCount(0);
  await page.goto("/routing?presets=error");
  await expect(page.getByText("EQ presets could not be loaded. The effect keeps its current settings.")).toBeVisible();
  await page.getByRole("button",{name:"Retry loading EQ presets"}).click();
  await expect(log(page)).toHaveText("retry");
});
