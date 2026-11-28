import {expect,test} from "playwright/test";

// Mixer and MIDI cluster in React Native Web: real pointer drags, keys and
// clicks against the controlled components, with the fixture standing in
// for the engine. Review captures go to shots/mixer-*.
const log=page=>page.getByTestId("log");
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];

async function drag(page,locator,dx,dy){
  await locator.scrollIntoViewIfNeeded();
  const box=await locator.boundingBox();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+dx/2,y+dy/2,{steps:4});
  await page.mouse.move(x+dx,y+dy,{steps:4});
  await page.mouse.up();
}

test("console: fader and pan drags commit once; mute and solo toggle",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer");
  const bass=page.getByRole("slider",{name:"Bass",exact:true});
  await drag(page,bass,0,-40);
  await expect(log(page)).toHaveText(/^gain 2 \d\.\d{3}$/);
  await drag(page,page.getByRole("slider",{name:"Bass pan"}),30,0);
  await expect(log(page)).toContainText("pan 2 0.2");
  expect((await log(page).innerText()).split("\n")).toHaveLength(2);
  await page.getByRole("button",{name:"Solo Drums"}).click();
  await expect(page.getByRole("button",{name:"Mute Bass"})).toHaveAccessibleDescription(/another channel is soloed/);
  await page.getByRole("button",{name:"Mute Keys"}).click();
  await expect(log(page)).toContainText("solo 1 true\nmute 3 false");
  const pan=page.getByRole("slider",{name:"Vocal pan"});
  await pan.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Home");
  await expect(log(page)).toContainText("pan 4 0.05\npan 4 0.1\npan 4 0");
});

test("piano roll: drag moves time and pitch in one commit, grip resizes, keys edit",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer");
  const note=page.getByRole("button",{name:/^E4, beat 1\.50/});
  await drag(page,note,48,-44);
  await expect(log(page)).toHaveText("move 1 960 65");
  const moved=page.getByRole("button",{name:/^F4, beat 2,/});
  await moved.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(log(page)).toContainText("resize 1 720\nmove 1 960 64");
  await page.keyboard.press("Delete");
  await expect(log(page)).toContainText("remove 1");
  await page.getByRole("button",{name:"Play C5"}).click();
  await expect(log(page)).toContainText("audition 72");
});

test("velocity lane and step sequencer commit per gesture",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer");
  await drag(page,page.getByRole("slider",{name:"Velocity of G4 note 3"}),0,30);
  await expect(log(page)).toHaveText(/^velocity 2 \d+$/);
  await page.getByRole("button",{name:"Snare, step 13"}).click();
  await page.getByRole("button",{name:"Kick, step 1",exact:true}).click();
  await expect(log(page)).toContainText("step+ 38 2880\nstep- 0");
  await page.getByRole("button",{name:"Hat, step 3"}).focus();
  await page.keyboard.press("a");
  await expect(log(page)).toContainText("accent 0 127");
});

test("tempo: tap tempo commits once when tapping stops; time signature commits",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer");
  const tap=page.getByRole("button",{name:"Tap tempo"});
  for(let i=0;i<4;i++){await tap.click();await page.waitForTimeout(400);}
  await expect(page.getByText(/BPM from 4 taps/)).toBeVisible();
  await expect(log(page)).toHaveText("",{timeout:500});
  await expect(log(page)).toHaveText(/^tempo 1\d\d(\.\d)?$/,{timeout:4000});
  await page.getByRole("button",{name:"More beats per bar"}).click();
  await page.getByRole("radio",{name:"Beat unit 8"}).click();
  await page.getByRole("switch",{name:"Metronome"}).click();
  await expect(log(page)).toContainText("sig 5/4\nsig 5/8\nclick true");
});

test("waveform: sideways drag scrolls the window, a click seeks",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/mixer");
  const wave=page.getByRole("slider",{name:"Vocal take"});
  await drag(page,wave,-120,0);
  await expect(log(page)).toHaveText(/^range 0\.\d{3}$/);
  await wave.click({position:{x:10,y:20}});
  await expect(log(page)).toContainText("seek 0.");
});

for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`capture mixer ${theme} ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/mixer?theme="+theme);
    await page.screenshot({path:`shots/mixer-${theme}-${name}.png`,fullPage:true});
    await page.getByRole("slider",{name:"Bass pan"}).focus();
    await page.getByTestId("console").screenshot({path:`shots/mixer-${theme}-${name}-console-focus.png`});
    await page.getByRole("button",{name:/^C4, beat 1,/}).focus();
    await page.getByTestId("midi").screenshot({path:`shots/mixer-${theme}-${name}-midi-focus.png`});
    const no=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(no,"no horizontal page scroll").toBeLessThanOrEqual(0);
  });
}
test("capture mixer rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/mixer?dir=rtl");
  await page.screenshot({path:"shots/mixer-rtl-phone.png",fullPage:true});
  const left=await page.getByRole("button",{name:"Play C5"}).boundingBox();
  const grid=await page.getByRole("button",{name:/^C4, beat 1,/}).boundingBox();
  expect(grid.x,"musical time stays left to right in RTL").toBeGreaterThan(left.x);
});
