import {test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
const views=[["marquee","&selected=1"],["wand","&selected=1"],["drop",""],["reference",""],["gestures",""]];
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`selection-tools capture ${theme} ${name}`,async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.setViewportSize(size);
    for(const [v,extra] of views){
      await page.goto(`/selection-tools?view=${v}&theme=${theme}${extra}`);
      await page.getByTestId("log").waitFor();
      await page.screenshot({path:`shots/selection-tools-${theme}-${name}-${v}.png`,fullPage:true});
    }
    // Mid-gesture states: a marquee being dragged and a colour being dropped.
    await page.goto(`/selection-tools?view=marquee&theme=${theme}&selected=1`);
    const canvas=page.getByLabel(/^Selection canvas/);
    const box=await canvas.boundingBox();
    await page.mouse.move(box.x+40,box.y+30);await page.mouse.down();
    await page.mouse.move(box.x+box.width*0.6,box.y+box.height*0.7,{steps:6});
    await page.screenshot({path:`shots/selection-tools-${theme}-${name}-marquee-drag.png`,fullPage:true});
    await page.mouse.up();
    await page.goto(`/selection-tools?view=drop&theme=${theme}`);
    const chip=page.getByRole("button",{name:"Coral fill colour"});
    const c=await chip.boundingBox();const t=await page.getByTestId("color-drop-target").boundingBox();
    await page.mouse.move(c.x+22,c.y+22);await page.mouse.down();
    await page.mouse.move(t.x+t.width/2,t.y+t.height/2,{steps:8});
    await page.screenshot({path:`shots/selection-tools-${theme}-${name}-drop-drag.png`,fullPage:true});
    await page.mouse.up();
    await page.goto(`/selection-tools?view=gestures&theme=${theme}`);
    await page.getByRole("combobox",{name:"Hide interface"}).click();
    await page.getByRole("option",{name:"Two-finger tap"}).click();
    await page.screenshot({path:`shots/selection-tools-${theme}-${name}-gestures-conflict.png`,fullPage:true});
    if(errors.length)throw new Error(errors.join("\n"));
  });
}
test("selection-tools capture rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  for(const v of ["marquee","wand","reference","gestures"]){
    await page.goto(`/selection-tools?view=${v}&dir=rtl&selected=1`);
    await page.getByTestId("log").waitFor();
    await page.screenshot({path:`shots/selection-tools-rtl-phone-${v}.png`,fullPage:true});
  }
});
