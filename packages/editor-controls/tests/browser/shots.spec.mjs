import {test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`capture seek bar ${theme} ${name}`,async({page})=>{
    // @expo/ui Text follows the OS scheme, so match it to the app theme.
    await page.emulateMedia({colorScheme:theme});
    await page.setViewportSize(size);
    await page.goto("/?theme="+theme);
    await page.getByTestId("seek").screenshot({path:`shots/${theme}-${name}-seek.png`});
  });
}
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`capture layers ${theme} ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/?theme="+theme);
    const stack=page.getByLabel("Layers",{exact:true});
    await stack.scrollIntoViewIfNeeded();
    await stack.screenshot({path:`shots/layers-${theme}-${name}.png`});
    await page.getByRole("button",{name:"Remove Badge"}).focus();
    await stack.screenshot({path:`shots/layers-${theme}-${name}-remove-focus.png`});
  });
}
test("capture layers rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/?dir=rtl");
  const stack=page.getByLabel("Layers",{exact:true});
  await stack.scrollIntoViewIfNeeded();
  await stack.screenshot({path:"shots/layers-light-phone-rtl.png"});
});
