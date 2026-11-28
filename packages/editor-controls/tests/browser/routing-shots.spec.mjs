import {expect,test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
async function shoot(page,url,path){
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(url);
  await page.getByTestId("log").waitFor({state:"attached"});
  await page.waitForTimeout(150);
  await page.screenshot({path,fullPage:true});
  const over=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(over,"no horizontal page scroll").toBeLessThanOrEqual(0);
  if(errors.length)throw new Error(errors.join("\n"));
}
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`routing capture ${theme} ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await shoot(page,`/routing?theme=${theme}`,`shots/routing-${theme}-${name}.png`);
    await page.getByRole("slider",{name:"Lead vocal send to Reverb"}).focus();
    await page.getByTestId("matrix").screenshot({path:`shots/routing-${theme}-${name}-matrix-focus.png`});
    await shoot(page,`/routing?theme=${theme}&full=1`,`shots/routing-${theme}-${name}-full.png`);
    await shoot(page,`/routing?theme=${theme}&empty=1`,`shots/routing-${theme}-${name}-empty.png`);
  });
}
test("routing capture rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await shoot(page,"/routing?dir=rtl","shots/routing-rtl-phone.png");
});
test("routing capture narrow pane, no buses, error",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await shoot(page,"/routing?narrow=1","shots/routing-light-tablet-narrow.png");
  await page.setViewportSize({width:390,height:844});
  await shoot(page,"/routing?nobus=1&presets=error&theme=dark","shots/routing-dark-phone-nobus-error.png");
});
