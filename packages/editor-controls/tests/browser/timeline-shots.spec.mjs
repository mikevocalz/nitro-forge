import {test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`timeline capture ${theme} ${name}`,async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(size);
    await page.goto(`/timeline?theme=${theme}&select=12&frame=150`);
    await page.getByTestId("lanes").waitFor();
    await page.screenshot({path:`shots/timeline-${theme}-${name}.png`,fullPage:true});
    await page.goto(`/timeline?theme=${theme}&rate=ntsc&guide=scope&frame=200`);
    await page.getByTestId("lanes").waitFor();
    await page.getByTestId("rate-toggle").click();
    await page.screenshot({path:`shots/timeline-${theme}-${name}-ntsc.png`,fullPage:true});
    if(errors.length)throw new Error(errors.join("\n"));
  });
}
test("timeline capture rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/timeline?dir=rtl&select=12&frame=150");
  await page.getByTestId("lanes").waitFor();
  await page.screenshot({path:"shots/timeline-rtl-phone.png",fullPage:true});
});
