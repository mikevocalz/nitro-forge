import {expect,test} from "playwright/test";

// Review captures for the velocity line tool and MIDI channel picker:
// shots/midi2-{light,dark}-{phone,tablet}.png, an RTL phone capture and one
// taken mid-way through a line drawing.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];

for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`capture midi2 ${theme} ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/midi2?theme="+theme);
    // Select the channel-10 note so the channel picker and the ramp row show.
    await page.getByRole("button",{name:/^D4, beat 3,/}).focus();
    await page.getByRole("slider",{name:"Velocity of D4 note 5"}).focus();
    await page.screenshot({path:`shots/midi2-${theme}-${name}.png`,fullPage:true});
    const no=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(no,"no horizontal page scroll").toBeLessThanOrEqual(0);
  });
}

test("capture midi2 rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/midi2?dir=rtl");
  await page.getByRole("button",{name:/^D4, beat 3,/}).focus();
  await page.screenshot({path:"shots/midi2-rtl-phone.png",fullPage:true});
  const bars=await page.getByTestId("lane").getByRole("radio",{name:"Bars"}).boundingBox();
  const line=await page.getByTestId("lane").getByRole("radio",{name:"Line"}).boundingBox();
  expect(line.x,"tool row mirrors in RTL").toBeLessThan(bars.x);
  const first=await page.getByRole("slider",{name:"Velocity of C4 note 1"}).boundingBox();
  const last=await page.getByRole("slider",{name:"Velocity of F4 note 6"}).boundingBox();
  expect(first.x,"time stays left to right").toBeLessThan(last.x);
});

for(const theme of ["light","dark"])test(`capture midi2 mid-line-draw ${theme} phone`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/midi2?theme="+theme);
  const layer=page.getByTestId("lane-draw");
  await layer.scrollIntoViewIfNeeded();
  const box=await layer.boundingBox();
  await page.mouse.move(box.x+4,box.y+box.height*0.15);await page.mouse.down();
  await page.mouse.move(box.x+Math.min(box.width-4,200),box.y+box.height*0.8,{steps:8});
  await page.getByTestId("midi").screenshot({path:`shots/midi2-${theme}-phone-line-draw.png`});
  await page.mouse.up();
});
