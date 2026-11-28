import {test,expect} from "playwright/test";

// DevicePairingDialog in React Native Web: callback routing per state, 44px
// targets, the live region, and review captures at 390 and 834px in light,
// dark and RTL. Captures land in shots/ for the CI artifact; they are not
// pixel goldens.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
const states=["idle","scanning","system-pairing","connecting","awaiting-input","connected"];
const log=page=>page.getByTestId("pairing-log");
// The Modal fades in; capture after that animation (the spinner loops forever).
const settle=async page=>{
  await expect(page.getByTestId("pair")).toBeVisible();
  await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState==="finished"||a.effect?.getComputedTiming().iterations===Infinity));
};

test("stop and close reach different callbacks; a linked dialog closes without stop",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/pairing?state=scanning");
  await page.getByRole("button",{name:"Stop searching"}).click();
  await page.getByRole("button",{name:"Close",exact:true}).click();
  await expect(log(page)).toHaveText("log stop, close");
  await page.goto("/pairing?state=awaiting-input");
  await expect(page.getByText(/Linked to Forge Stylus/)).toBeVisible();
  await expect(page.getByText(/connected/i)).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Done"})).toHaveCount(0);
  await page.getByRole("button",{name:"Close",exact:true}).click();
  await expect(log(page)).toHaveText("log close");
  await page.goto("/pairing?state=connected");
  await page.getByRole("button",{name:"Close",exact:true}).click();
  await expect(log(page)).toHaveText("log done");
});

test("system-pairing lists the host's steps in order and opens Settings",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/pairing?state=system-pairing");
  await expect(page.getByLabel(/^Step 3 of 3: Select Forge Stylus/)).toBeVisible();
  await page.getByRole("button",{name:"Open Settings"}).click();
  await expect(log(page)).toHaveText("log settings");
});

test("idle shows the intro; every control is at least 44px; no horizontal scroll",async({page})=>{
  for(const [,size] of sizes)for(const state of states){
    await page.setViewportSize(size);
    await page.goto("/pairing?state="+state);
    await expect(page.getByTestId("pair")).toBeVisible();
    if(state==="idle")await expect(page.getByTestId("pair-intro")).toContainText("Bluetooth access");
    else await expect(page.getByTestId("pair-intro")).toHaveCount(0);
    for(const box of await page.getByRole("button").evaluateAll(els=>els.map(e=>e.getBoundingClientRect().height)))
      expect(box,state).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),state).toBe(true);
  }
});

for(const theme of ["light","dark"])for(const [name,size] of sizes)test(`captures ${theme} ${name}`,async({page})=>{
  await page.setViewportSize(size);
  for(const state of states){
    await page.goto(`/pairing?state=${state}&theme=${theme}`);
    await settle(page);
    await page.screenshot({path:`shots/pairing-${theme}-${name}-${state}.png`});
  }
});

test("captures RTL",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  for(const state of ["idle","system-pairing","awaiting-input"]){
    await page.goto(`/pairing?state=${state}&dir=rtl`);
    await settle(page);
    await page.screenshot({path:`shots/pairing-rtl-phone-${state}.png`});
  }
});
