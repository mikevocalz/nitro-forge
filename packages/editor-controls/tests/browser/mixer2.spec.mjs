import {expect,test} from "playwright/test";

// Mixer core in React Native Web: group solo and mute, solo safe, bus
// balance and routing text, and display-only meters, against the fixture's
// stand-in engine. Every commit is one line in the log.
const log=page=>page.getByTestId("log");
const lines=async page=>(await log(page).innerText()).split("\n").filter(Boolean);

async function drag(page,locator,dx,dy){
  await locator.scrollIntoViewIfNeeded();
  const box=await locator.boundingBox();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+dx/2,y+dy/2,{steps:4});
  await page.mouse.move(x+dx,y+dy,{steps:4});
  await page.mouse.up();
}

test("group solo and mute: one commit per press, mixed state, solo silencing follows",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer2");
  const music=page.getByRole("button",{name:"Mute group Music"});
  await expect(music).toHaveAttribute("aria-pressed","mixed");
  await expect(page.getByRole("group",{name:"Drums group, 2 channels"})).toBeVisible();
  const drums=page.getByRole("button",{name:"Solo group Drums"});
  await expect(drums).toHaveAttribute("aria-pressed","false");
  await drums.click();
  await expect(log(page)).toHaveText("gsolo Drums true");
  await expect(drums).toHaveAttribute("aria-pressed","true");
  // Drums soloed: tracks outside the group go silent, the bus they feed does not.
  await expect(page.getByRole("button",{name:"Mute Bass"})).toHaveAccessibleDescription(/another channel is soloed/);
  await expect(page.getByRole("button",{name:"Mute Drum bus"})).not.toHaveAccessibleDescription(/soloed/);
  await expect(page.getByRole("button",{name:"Mute Reverb"})).toHaveAccessibleDescription(/another channel is soloed/);
  // One member un-soloed: the group shows mixed and the next press solos all.
  await page.getByRole("button",{name:"Solo Kick"}).click();
  await expect(drums).toHaveAttribute("aria-pressed","mixed");
  await drums.click();
  await music.click();
  expect(await lines(page)).toEqual(["gsolo Drums true","solo 1 false","gsolo Drums true","gmute Music true"]);
  await expect(music).toHaveAttribute("aria-pressed","true");
});

test("solo safe: toggle commits once and keeps the track audible under another solo",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer2");
  await page.getByRole("button",{name:"Solo Kick"}).click();
  const bassMute=page.getByRole("button",{name:"Mute Bass"});
  await expect(bassMute).toHaveAccessibleDescription(/another channel is soloed/);
  const safe=page.getByRole("button",{name:"Solo safe Bass"});
  await safe.focus();
  await page.keyboard.press("Enter");
  await expect(safe).toHaveAttribute("aria-pressed","true");
  await expect(bassMute).not.toHaveAccessibleDescription(/soloed/);
  await expect(page.getByRole("group",{name:/^Bass, solo safe$/})).toBeAttached();
  expect(await lines(page)).toEqual(["solo 1 true","safe 3 true"]);
});

test("bus strips: balance slider, routing text, fader drag commits once, Escape-free keys",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer2");
  await expect(page.getByText("to Drum bus").first()).toBeVisible();
  await expect(page.getByRole("slider",{name:"Drum bus pan"})).toHaveCount(0);
  const balance=page.getByRole("slider",{name:"Drum bus balance"});
  await balance.focus();
  await page.keyboard.press("ArrowRight");
  await expect(balance).toHaveAttribute("aria-valuetext","5 percent right, left side at 95 percent");
  await drag(page,page.getByRole("slider",{name:"Reverb",exact:true}),0,-30);
  const got=await lines(page);
  expect(got).toHaveLength(2);
  expect(got[0]).toBe("pan 10 0.05");
  expect(got[1]).toMatch(/^gain 11 \d\.\d{3}$/);
  await expect(page.getByRole("group",{name:/^Drum bus, bus$/})).toBeAttached();
});

test("meters: display only, clipped channel named in text, absent when not passed",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer2");
  const snare=page.getByRole("progressbar",{name:"Snare level"});
  await expect(snare).toHaveAttribute("aria-valuetext","Clipping");
  await expect(page.getByText("Clip",{exact:true})).toBeVisible();
  await expect(page.getByRole("progressbar",{name:"Keys level"})).toHaveAttribute("aria-valuetext","Silent");
  await expect(page.getByRole("progressbar")).toHaveCount(7);
  // Numeric gain entry must not widen the fader into its meter or next strip.
  const channel=page.getByRole("group",{name:/^Snare,/});
  const channelBox=await channel.boundingBox();
  const faderBox=await page.getByLabel("Snare fader",{exact:true}).boundingBox();
  const meterBox=await snare.boundingBox();
  expect(faderBox.x).toBeGreaterThanOrEqual(channelBox.x);
  expect(faderBox.x+faderBox.width).toBeLessThanOrEqual(meterBox.x);
  expect(meterBox.x+meterBox.width).toBeLessThanOrEqual(channelBox.x+channelBox.width);
  await snare.click();
  await expect(log(page)).toHaveText("");
  await page.goto("/mixer2?meters=0");
  await expect(page.getByRole("slider",{name:"Snare",exact:true})).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

for(const [name,size] of [["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]]){
  test(`44px targets and no page scroll: ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/mixer2");
    const buttons=page.getByTestId("console").getByRole("button");
    const n=await buttons.count();
    expect(n).toBeGreaterThan(30);
    for(let i=0;i<n;i++){
      const box=await buttons.nth(i).boundingBox();
      if(!box)continue;
      expect(box.width,`button ${i} width`).toBeGreaterThanOrEqual(44);
      expect(box.height,`button ${i} height`).toBeGreaterThanOrEqual(44);
    }
    const no=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(no,"no horizontal page scroll").toBeLessThanOrEqual(0);
  });
}
