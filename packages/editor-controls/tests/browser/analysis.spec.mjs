import {expect,test} from "playwright/test";

// LoudnessMeter and SpectrogramView in React Native Web against a fixture
// standing in for the engine's loudness/spectrogram replies.
const log=page=>page.getByTestId("log");

test("target radiogroup: click and arrow keys change the target once per press",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/analysis");
  const group=page.getByRole("radiogroup",{name:"Loudness target"});
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(page.getByText("1.8 LU over target")).toBeVisible();
  await group.getByRole("radio",{name:/−23\.0 LUFS, Broadcast/}).click();
  await expect(log(page)).toHaveText("target -23");
  await expect(page.getByText("10.8 LU over target")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(log(page)).toHaveText("target -23\ntarget -16");
  await expect(group.getByRole("radio",{name:/−16\.0 LUFS/})).toBeFocused();
  await expect(group.getByRole("radio",{name:/−16\.0 LUFS/})).toHaveAttribute("aria-checked","true");
  // Pressing the checked radio again commits nothing.
  await group.getByRole("radio",{name:/−16\.0 LUFS/}).click();
  expect((await log(page).innerText()).split("\n")).toHaveLength(2);
});

test("rejected target change keeps the previous selection",async({page})=>{
  await page.goto("/analysis?reject=1");
  const group=page.getByRole("radiogroup",{name:"Loudness target"});
  await group.getByRole("radio",{name:/−16\.0 LUFS/}).click();
  await expect(log(page)).toHaveText("target -16");
  await expect(group.getByRole("radio",{name:/−14\.0 LUFS/})).toHaveAttribute("aria-checked","true");
  await expect(page.getByText("1.8 LU over target")).toBeVisible();
});

test("readouts, peak warning and accessible summaries",async({page})=>{
  await page.goto("/analysis");
  await expect(page.getByText("Within 1 dB of full scale")).toBeVisible();
  await expect(page.getByLabel(/^Integrated −12\.2 LUFS, 1\.8 LU over target of −14\.0 LUFS/)).toBeVisible();
  await expect(page.getByRole("img",{name:/^Momentary loudness over 32\.3 s, loudest/})).toBeVisible();
  await expect(page.getByRole("img",{name:/^Spectrogram, 32\.0 seconds, 31 Hz to .* kHz\. Loudest: /})).toBeVisible();
  for(const t of ["100 Hz","1 kHz","10 kHz","0 s"])await expect(page.getByTestId("spectrogram").getByText(t,{exact:true}).first()).toBeVisible();
  const cells=await page.getByTestId("spectrogram-plot").locator("> div").count();
  expect(cells).toBeGreaterThan(0);
  expect(cells).toBeLessThanOrEqual(96*32);
});

test("states: measuring, error with retry, silent",async({page})=>{
  await page.goto("/analysis?state=measuring");
  await expect(page.getByText("Measuring loudness of the selected range")).toBeVisible();
  await expect(page.getByRole("group",{name:"Master, bars 1-17"})).toHaveAttribute("aria-busy","true");
  await page.goto("/analysis?state=error");
  await expect(page.getByText(/track 3 references a missing file/)).toBeVisible();
  await page.getByRole("button",{name:"Measure again"}).click();
  await expect(log(page)).toHaveText("retry");
  await expect(page.getByText("1.8 LU over target")).toBeVisible();
  await page.goto("/analysis?state=silent");
  await expect(page.getByText(/This range is silent/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Measure again"})).toHaveCount(0);
  await expect(page.getByText(/no audio in this range/)).toBeVisible();
});

test("44px radios and no horizontal scroll at 390px, LTR and RTL",async({page})=>{
  for(const dir of ["ltr","rtl"]){
    await page.setViewportSize({width:390,height:844});
    await page.goto("/analysis?dir="+dir);
    for(const radio of await page.getByRole("radio").all()){
      const box=await radio.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
});

test("RTL keeps the time axis left to right and arrows follow reading order",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/analysis?dir=rtl");
  const spectro=page.getByTestId("spectrogram");
  const zero=await spectro.getByText("0 s",{exact:true}).boundingBox();
  const ten=await spectro.getByText("10 s",{exact:true}).boundingBox();
  expect(zero.x).toBeLessThan(ten.x);
  const group=page.getByRole("radiogroup",{name:"Loudness target"});
  await group.getByRole("radio",{name:/−14\.0 LUFS/}).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(log(page)).toHaveText("target -16");
});
