import {expect,test} from "playwright/test";

// EQ graph and compressor transfer graph in React Native Web: real pointer
// drags and keys against the controlled components, with the fixture
// standing in for the engine (answers after 120 ms).
const log=page=>page.getByTestId("log");
const lines=async page=>(await log(page).innerText()).split("\n").filter(Boolean);

async function drag(page,locator,dx,dy,{cancel=false}={}){
  await locator.scrollIntoViewIfNeeded();
  const box=await locator.boundingBox();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+dx/2,y+dy/2,{steps:4});
  await page.mouse.move(x+dx,y+dy,{steps:4});
  if(cancel)await page.keyboard.press("Escape");
  await page.mouse.up();
}

test("eq: a handle drag moves frequency and gain in one commit",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/eqdyn");
  const band=page.getByRole("slider",{name:"Band 3"});
  await expect(band).toHaveAttribute("aria-valuetext","Peak 1.2 kHz, plus 3 dB");
  await drag(page,band,60,-30);
  await expect(log(page)).toHaveText(/^band 2 \d+ \d+(\.\d)?$/);
  const [,,freq,gain]=(await log(page).innerText()).split(" ");
  expect(Number(freq)).toBeGreaterThan(1200);
  expect(Number(gain)).toBeGreaterThan(3);
  await expect(band).toHaveAttribute("aria-valuetext",new RegExp("^Peak "));
  expect(await lines(page)).toHaveLength(1);
});

test("eq: Escape mid-drag cancels without a commit",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/eqdyn");
  const band=page.getByRole("slider",{name:"Band 5"});
  await band.focus();
  await drag(page,band,-50,40,{cancel:true});
  await page.waitForTimeout(300);
  await expect(log(page)).toHaveText("");
  await expect(band).toHaveAttribute("aria-valuetext","High shelf 10 kHz, plus 2 dB");
});

test("eq: keyboard steps commit once per key, Shift is fine, pass bands ignore gain keys",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/eqdyn");
  const band=page.getByRole("slider",{name:"Band 3"});
  await band.focus();
  await page.keyboard.press("ArrowRight");
  await expect(band).toHaveAttribute("aria-valuetext","Peak 1.27 kHz, plus 3 dB");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(band).toHaveAttribute("aria-valuetext","Peak 1.27 kHz, plus 3.1 dB");
  await page.keyboard.press("PageDown");
  await expect(log(page)).toContainText("band 2 1270 3\nband 2 1270 3.1\nband 2 1270 0.1");
  const hp=page.getByTestId("eq").getByRole("slider",{name:"Band 1",exact:true});
  await hp.focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  expect(await lines(page)).toHaveLength(3);
  await page.keyboard.press("ArrowLeft");
  await expect(log(page)).toContainText("band 0 75.5 0");
});

test("eq: band chips select, the readout follows, the on toggle commits",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/eqdyn");
  await page.getByRole("radio",{name:"Band 4"}).click();
  const toggle=page.getByRole("button",{name:"Band 4 on"});
  await expect(toggle).toHaveAttribute("aria-pressed","false");
  await expect(page.getByLabel("Freq 3.5 kHz")).toBeVisible();
  await toggle.click();
  await expect(log(page)).toHaveText("enabled 3 true");
  await expect(toggle).toHaveAttribute("aria-pressed","true");
});

test("eq: a rejected commit keeps the committed band",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/eqdyn?reject=1");
  const band=page.getByRole("slider",{name:"Band 3"});
  await band.focus();
  await page.keyboard.press("ArrowUp");
  await expect(log(page)).toHaveText("band 2 1200 3.5");
  await page.waitForTimeout(300);
  await expect(band).toHaveAttribute("aria-valuetext","Peak 1.2 kHz, plus 3 dB");
});

test("compressor: threshold drag and keys commit once; ratio stepper walks the stops",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/eqdyn");
  const thr=page.getByRole("slider",{name:"Threshold"}).first();
  await drag(page,thr,40,0);
  await expect(log(page)).toHaveText(/^threshold -\d+$/);
  const after=Number((await log(page).innerText()).split(" ")[1]);
  expect(after).toBeGreaterThan(-18);
  await expect(thr).toHaveAttribute("aria-valuenow",String(after));
  await thr.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(log(page)).toContainText("threshold "+(after-1));
  await drag(page,thr,-60,0,{cancel:true});
  await page.getByRole("button",{name:"Raise ratio"}).first().click();
  await expect(page.getByLabel("Ratio 4:1")).toBeVisible();
  await page.getByRole("button",{name:"Lower ratio"}).first().click();
  await expect(log(page)).toContainText("ratio 4\nratio 3");
  expect(await lines(page)).toHaveLength(4);
});

test("empty and disabled states are honest",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/eqdyn");
  await expect(page.getByTestId("eq-empty").getByText("Response unavailable")).toBeVisible();
  await expect(page.getByTestId("comp-empty").getByText("Curve unavailable")).toBeVisible();
  await expect(page.getByTestId("comp-empty").getByRole("button",{name:"Raise ratio"})).toBeDisabled();
});

for(const [name,size] of [["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]]){
  test(`targets are at least 44 px and nothing scrolls sideways (${name})`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/eqdyn");
    await page.getByTestId("eq").getByRole("slider",{name:"Band 1",exact:true}).first().waitFor();
    for(const role of ["slider","button","radio"]){
      for(const el of await page.getByRole(role).all()){
        const box=await el.boundingBox();
        if(!box)continue;
        expect(box.width,`${role} ${await el.getAttribute("aria-label")} width`).toBeGreaterThanOrEqual(44);
        expect(box.height,`${role} ${await el.getAttribute("aria-label")} height`).toBeGreaterThanOrEqual(44);
      }
    }
    const no=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(no,"no horizontal page scroll").toBeLessThanOrEqual(0);
  });
}

test("rtl keeps frequency and level axes left to right",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/eqdyn?dir=rtl");
  const low=await page.getByTestId("eq").getByRole("slider",{name:"Band 1",exact:true}).boundingBox();
  const high=await page.getByRole("slider",{name:"Band 5"}).boundingBox();
  expect(low.x,"80 Hz sits left of 10 kHz").toBeLessThan(high.x);
  const eq=page.getByTestId("eq");
  const hundred=await eq.getByText("100",{exact:true}).boundingBox();
  const tenK=await eq.getByText("10k",{exact:true}).boundingBox();
  expect(hundred.x).toBeLessThan(tenK.x);
});
