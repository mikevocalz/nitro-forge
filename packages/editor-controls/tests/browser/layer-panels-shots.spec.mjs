import {test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
const settle=async page=>{
  await page.getByTestId("layer-stack").waitFor();
  await page.getByRole("img",{name:"Ready"}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"] img[src^="data"]')&&
    document.querySelectorAll('img[src^="data:image/png"]').length>8);
};
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`layer panels capture ${theme} ${name}`,async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(size);
    await page.goto(`/layer-panels?theme=${theme}`);
    await settle(page);
    await page.screenshot({path:`shots/layer-panels-${theme}-${name}.png`,fullPage:true});
    await page.goto(`/layer-panels?theme=${theme}&only=boards&mode=side-by-side`);
    await page.getByTestId("artboards").waitFor();
    await page.screenshot({path:`shots/layer-panels-${theme}-${name}-side-by-side.png`,fullPage:true});
    for(const mode of ["overlay","reference"]){
      await page.goto(`/layer-panels?theme=${theme}&only=boards&mode=${mode}`);
      await page.getByTestId("compare").waitFor();
      await page.getByTestId("compare").screenshot({path:`shots/layer-panels-${theme}-${name}-${mode}.png`});
    }
    await page.goto(`/layer-panels?theme=${theme}&only=layers&layer=photo`);
    await page.getByTestId("mask-editor").waitFor();
    await page.getByRole("button",{name:"From selection, unavailable"}).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.getByTestId("mask-editor").screenshot({path:`shots/layer-panels-${theme}-${name}-no-mask-focus.png`});
    if(errors.length)throw new Error(errors.join("\n"));
  });
}
test("layer panels capture rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/layer-panels?dir=rtl");
  await settle(page);
  await page.screenshot({path:"shots/layer-panels-rtl-phone.png",fullPage:true});
});
test("layer panels capture rtl tablet grid",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/layer-panels?dir=rtl&theme=dark");
  await settle(page);
  await page.screenshot({path:"shots/layer-panels-rtl-tablet.png",fullPage:true});
});
