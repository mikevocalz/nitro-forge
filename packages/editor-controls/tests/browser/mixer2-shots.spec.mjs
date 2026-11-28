import {expect,test} from "playwright/test";

// Review captures for the mixer core (meters, groups, solo safe, buses):
// shots/mixer2-{light,dark}-{phone,tablet}.png, shots/mixer2-rtl-phone.png,
// and shots/mixer2-clip-solo-{light,dark}.png with a clipped channel and a
// soloed group.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];

for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`capture mixer2 ${theme} ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/mixer2?theme="+theme);
    await expect(page.getByRole("progressbar",{name:"Snare level"})).toBeVisible();
    await page.screenshot({path:`shots/mixer2-${theme}-${name}.png`,fullPage:true});
    const no=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(no,"no horizontal page scroll").toBeLessThanOrEqual(0);
  });
}
for(const theme of ["light","dark"]){
  test(`capture mixer2 clipped channel and soloed group ${theme}`,async({page})=>{
    await page.setViewportSize({width:834,height:1194});
    await page.goto("/mixer2?theme="+theme);
    await page.getByRole("button",{name:"Solo group Drums"}).click();
    await page.getByRole("button",{name:"Solo Kick"}).click();
    await page.getByRole("button",{name:"Solo safe Bass"}).click();
    await page.getByRole("slider",{name:"Drum bus balance"}).focus();
    await page.getByTestId("console").screenshot({path:`shots/mixer2-clip-solo-${theme}.png`});
  });
}
test("capture mixer2 rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/mixer2?dir=rtl");
  await page.screenshot({path:"shots/mixer2-rtl-phone.png",fullPage:true});
  const no=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(no,"no horizontal page scroll").toBeLessThanOrEqual(0);
});
