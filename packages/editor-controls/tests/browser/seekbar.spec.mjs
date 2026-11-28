import {test,expect} from "playwright/test";

// Guards NYC-Tron UI #27 (https://github.com/mikevocalz/NYC-Tron-UI/issues/27): the frame-step buttons and the timecode sit on one row under the
// slider, as in the Forge original, at phone and tablet widths.
for(const width of [390,834]){
  test(`transport is one row under the slider at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.goto("/");
    const seek=page.getByTestId("seek");
    const slider=await seek.getByRole("slider").boundingBox();
    const back=await seek.getByRole("button",{name:"−1 frame"}).boundingBox();
    const fwd=await seek.getByRole("button",{name:"+1 frame"}).boundingBox();
    const time=await seek.getByText("00:00:05:00 / 00:00:10:00").boundingBox();
    const mid=b=>b.y+b.height/2;
    for(const b of [back,fwd,time])expect(b.y).toBeGreaterThanOrEqual(slider.y+slider.height);
    expect(Math.abs(mid(back)-mid(fwd))).toBeLessThanOrEqual(1);
    expect(Math.abs(mid(back)-mid(time))).toBeLessThanOrEqual(2);
    expect(back.x+back.width).toBeLessThanOrEqual(time.x);
    expect(time.x+time.width).toBeLessThanOrEqual(fwd.x);
  });
}

test("frame buttons step the controlled frame",async({page})=>{
  await page.goto("/");
  const seek=page.getByTestId("seek");
  await seek.getByRole("button",{name:"+1 frame"}).click();
  await expect(page.getByTestId("frame")).toHaveText("frame 121");
  await expect(seek.getByText("00:00:05:01 / 00:00:10:00")).toBeVisible();
  await seek.getByRole("button",{name:"−1 frame"}).click();
  await seek.getByRole("button",{name:"−1 frame"}).click();
  await expect(page.getByTestId("frame")).toHaveText("frame 119");
});

// The timecode follows the app theme, not the OS scheme: dark app on a light OS.
test("timecode uses the theme text token in dark mode on a light OS",async({page})=>{
  await page.emulateMedia({colorScheme:"light"});
  await page.goto("/?theme=dark");
  const color=await page.getByTestId("seek").getByText("00:00:05:00 / 00:00:10:00").evaluate(e=>getComputedStyle(e).color);
  expect(color).toBe("rgb(232, 235, 240)");
});

test("transport stays inside the card at 390px",async({page})=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto("/");
  const card=await page.getByTestId("seek").boundingBox();
  const fwd=await page.getByTestId("seek").getByRole("button",{name:"+1 frame"}).boundingBox();
  expect(fwd.x+fwd.width).toBeLessThanOrEqual(card.x+card.width);
});

// A mouse drag previews on every frame it crosses and seeks once on release.
test("dragging the slider previews and commits once on release",async({page})=>{
  await page.goto("/");
  const box=await page.getByTestId("seek").getByRole("slider").boundingBox();
  const y=box.y+box.height/2;
  await page.mouse.move(box.x+box.width*0.5,y);
  await page.mouse.down();
  for(const f of [0.55,0.6,0.65,0.7,0.75])await page.mouse.move(box.x+box.width*f,y,{steps:3});
  const mid=await page.getByTestId("seek-log").textContent();
  expect(mid).toMatch(/^seek [1-9]\d*\/0$/);
  await page.mouse.up();
  await expect(page.getByTestId("seek-log")).toHaveText(/^seek [1-9]\d*\/1$/);
  const frame=Number((await page.getByTestId("frame").textContent()).split(" ")[1]);
  expect(frame).toBeGreaterThan(160);
});

test("an arrow key on the focused slider commits once",async({page})=>{
  await page.goto("/");
  await page.getByTestId("seek").getByRole("slider").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("seek-log")).toHaveText(/\/1$/);
  const frame=Number((await page.getByTestId("frame").textContent()).split(" ")[1]);
  expect(frame).toBeGreaterThan(120);
});
