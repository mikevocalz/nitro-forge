import {test,expect} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
const noScroll=async page=>{
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow,"horizontal page scroll").toBeLessThanOrEqual(0);
};
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`canvas guides capture ${theme} ${name}`,async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(size);
    await page.goto(`/canvas-guides?theme=${theme}&select=L2`);
    await page.getByRole("button",{name:"Horizontal ruler"}).waitFor();
    await noScroll(page);
    await page.screenshot({path:`shots/canvas-guides-${theme}-${name}.png`});
    // Mid-drag of a layer next to Badge: smart guides and the gap readout.
    const photo=await page.getByLabel("Photo",{exact:true}).boundingBox();
    await page.mouse.move(photo.x+photo.width/2,photo.y+photo.height/2);
    await page.mouse.down();
    await page.mouse.move(photo.x+photo.width/2+6,photo.y+photo.height/2+14,{steps:6});
    await page.screenshot({path:`shots/canvas-guides-${theme}-${name}-smart.png`});
    await page.keyboard.press("Escape");
    await page.mouse.up();
    // Mid-drag of a new guide out of the top ruler.
    const ruler=await page.getByRole("button",{name:"Horizontal ruler"}).boundingBox();
    await page.mouse.move(ruler.x+ruler.width/2,ruler.y+8);
    await page.mouse.down();
    await page.mouse.move(ruler.x+ruler.width/2-30,ruler.y+160,{steps:6});
    await page.screenshot({path:`shots/canvas-guides-${theme}-${name}-guide.png`});
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.goto(`/canvas-guides?theme=${theme}&select=L1,L2,L3`);
    await page.getByRole("button",{name:"Horizontal ruler"}).waitFor();
    await page.screenshot({path:`shots/canvas-guides-${theme}-${name}-panels.png`,fullPage:true});
    await page.getByRole("adjustable",{name:"Pivot"}).count();
    if(errors.length)throw new Error(errors.join("\n"));
  });
}
test("canvas guides capture rtl phone and focus",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/canvas-guides?dir=rtl&select=L3&unit=mm");
  await page.getByRole("button",{name:"Horizontal ruler"}).waitFor();
  await noScroll(page);
  await page.screenshot({path:"shots/canvas-guides-rtl-phone.png",fullPage:true});
  await page.getByRole("button",{name:"Vertical ruler"}).focus();
  await page.keyboard.press("Tab");
  await page.screenshot({path:"shots/canvas-guides-rtl-phone-focus.png"});
});
test("canvas guides capture locked and empty states",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/canvas-guides?select=L4");
  await page.getByRole("button",{name:"Horizontal ruler"}).waitFor();
  await page.screenshot({path:"shots/canvas-guides-light-tablet-locked.png"});
  await page.goto("/canvas-guides?select=&grid=0");
  await page.getByRole("button",{name:"Horizontal ruler"}).waitFor();
  await page.screenshot({path:"shots/canvas-guides-light-tablet-empty.png",fullPage:true});
});
