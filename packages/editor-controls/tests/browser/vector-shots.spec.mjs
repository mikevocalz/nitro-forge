import {test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
const ready=page=>page.getByTestId("vector-log").waitFor();
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`vector capture ${theme} ${name}`,async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(size);
    await page.goto(`/vector?theme=${theme}&select=1&picked=11,12`);
    await ready(page);
    await page.screenshot({path:`shots/vector-${theme}-${name}.png`,fullPage:true});
    await page.goto(`/vector?theme=${theme}&part=gradient&fill=radial`);
    await ready(page);
    await page.getByTestId("gradient-stop-1").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab"); // keyboard focus, so focus-visible rings draw
    await page.screenshot({path:`shots/vector-${theme}-${name}-radial-focus.png`,fullPage:true});
    await page.goto(`/vector?theme=${theme}&part=builder&picked=11,12`);
    await ready(page);
    await page.getByRole("button",{name:"Subtract"}).click();
    await page.screenshot({path:`shots/vector-${theme}-${name}-boolean.png`,fullPage:true});
    await page.goto(`/vector?theme=${theme}&part=inspector&kind=shape&fill=solid`);
    await ready(page);
    await page.screenshot({path:`shots/vector-${theme}-${name}-shape-inspector.png`,fullPage:true});
    if(errors.length)throw new Error(errors.join("\n"));
  });
}
test("vector capture rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/vector?dir=rtl&select=2&picked=11,13");
  await ready(page);
  await page.screenshot({path:"shots/vector-rtl-phone.png",fullPage:true});
});
