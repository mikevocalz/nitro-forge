import {test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`color capture ${theme} ${name}`,async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(size);
    for(const mode of ["compact","classic","palettes"]){
      await page.goto(`/color?theme=${theme}&mode=${mode}`);
      await page.getByTestId("palette").waitFor();
      await page.screenshot({path:`shots/color-${theme}-${name}-${mode}.png`,fullPage:true});
    }
    await page.goto(`/color?theme=${theme}&float=1&hinge=1&mode=classic`);
    await page.getByTestId("palette").waitFor();
    await page.screenshot({path:`shots/color-${theme}-${name}-floating.png`,fullPage:true});
    if(errors.length)throw new Error(errors.join("\n"));
  });
}
test("color capture rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/color?dir=rtl&mode=palettes");
  await page.getByTestId("palette").waitFor();
  await page.screenshot({path:"shots/color-rtl-phone-palettes.png",fullPage:true});
});
