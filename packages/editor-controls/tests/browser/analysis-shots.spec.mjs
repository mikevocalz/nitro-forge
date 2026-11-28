import {test} from "playwright/test";
// Review captures of LoudnessMeter and SpectrogramView, not pixel goldens.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
const ready=page=>page.getByRole("heading").first().waitFor();
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`analysis ${theme} ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/analysis?theme="+theme);
    await ready(page);
    await page.screenshot({path:`shots/analysis-${theme}-${name}.png`,fullPage:true});
  });
}
test("analysis rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/analysis?dir=rtl&theme=dark");
  await ready(page);
  await page.screenshot({path:"shots/analysis-rtl-phone.png",fullPage:true});
});
for(const state of ["measuring","error","silent"])test(`analysis ${state} phone`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/analysis?state="+state);
  await ready(page);
  await page.screenshot({path:`shots/analysis-${state}-phone.png`,fullPage:true});
});
