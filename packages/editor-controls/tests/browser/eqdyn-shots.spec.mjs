import {test} from "playwright/test";
// Review captures of the EQ and compressor graphs, not pixel goldens.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
const ready=page=>page.getByRole("slider",{name:"Band 1"}).first().waitFor();

for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`eqdyn ${theme} ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/eqdyn?theme="+theme);
    await ready(page);
    await page.screenshot({path:`shots/eqdyn-${theme}-${name}.png`,fullPage:true});
  });
}

test("eqdyn rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/eqdyn?dir=rtl");
  await ready(page);
  await page.screenshot({path:"shots/eqdyn-rtl-phone.png",fullPage:true});
});

test("eqdyn mid-drag and focus",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/eqdyn?latency=100000");
  await ready(page);
  const band=page.getByRole("slider",{name:"Band 3"});
  const b=await band.boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
  await page.mouse.down();
  await page.mouse.move(b.x+b.width/2+40,b.y+b.height/2-30,{steps:6});
  await page.getByTestId("eq").screenshot({path:"shots/eqdyn-light-phone-eq-drag.png"});
  await page.mouse.up();
  await page.getByTestId("eq").screenshot({path:"shots/eqdyn-light-phone-eq-stale.png"});
  const thr=page.getByRole("slider",{name:"Threshold"}).first();
  await thr.scrollIntoViewIfNeeded();
  const t=await thr.boundingBox();
  await page.mouse.move(t.x+t.width/2,t.y+t.height/2);
  await page.mouse.down();
  await page.mouse.move(t.x+t.width/2+50,t.y+t.height/2,{steps:6});
  await page.getByTestId("comp").screenshot({path:"shots/eqdyn-light-phone-comp-drag.png"});
  await page.mouse.up();
  await page.keyboard.press("Tab");
  await page.getByRole("button",{name:"Raise ratio"}).first().focus();
  await page.getByTestId("comp").screenshot({path:"shots/eqdyn-light-phone-comp-focus.png"});
});
