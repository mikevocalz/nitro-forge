import {test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`timeline cluster 2 capture ${theme} ${name}`,async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(size);
    // Selected clip, multi-selection, an existing transition and a loop.
    await page.goto(`/timeline2?theme=${theme}&select=22&multi=23,24&trans=1&loop=1&frame=100`);
    await page.getByTestId("stack-lanes").waitFor();
    await page.screenshot({path:`shots/timeline2-${theme}-${name}.png`,fullPage:true});
    // Roll tool with its edge handles, a selected marker with its editor, and a locked track.
    await page.goto(`/timeline2?theme=${theme}&select=22&tool=roll&locked=1&frame=100`);
    await page.getByTestId("stack-lanes").waitFor();
    await page.getByRole("adjustable",{name:/^Marker Gulls/}).or(page.getByLabel(/^Marker Gulls/)).first().click();
    await page.screenshot({path:`shots/timeline2-${theme}-${name}-roll-marker.png`,fullPage:true});
    // A selected cut feeds the preset browser.
    await page.goto(`/timeline2?theme=${theme}&frame=100`);
    await page.getByTestId("stack-lanes").waitFor();
    await page.getByRole("button",{name:/^Cut between Harbor wide and Ferry close-up/}).click();
    await page.getByRole("switch",{name:"Reorder tracks"}).click();
    if(name==="phone")await page.getByRole("button",{name:/^Music track settings/}).click();
    await page.screenshot({path:`shots/timeline2-${theme}-${name}-cut-reorder.png`,fullPage:true});
    if(errors.length)throw new Error(errors.join("\n"));
  });
}
test("timeline cluster 2 capture rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/timeline2?dir=rtl&select=22&trans=1&loop=1&frame=100");
  await page.getByTestId("stack-lanes").waitFor();
  await page.screenshot({path:"shots/timeline2-rtl-phone.png",fullPage:true});
});
