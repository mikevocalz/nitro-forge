import {expect,test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
const guard=page=>{const errors=[];page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});return errors;};

for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`automation capture ${theme} ${name}`,async({page})=>{
    const errors=guard(page);
    await page.setViewportSize(size);
    await page.goto("/automation?theme="+theme);
    await page.getByRole("slider",{name:"Point 2"}).first().focus();
    await page.screenshot({path:`shots/automation-${theme}-${name}.png`,fullPage:true});
    const over=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(over,"no horizontal page scroll").toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test("automation capture rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/automation?dir=rtl");
  await page.screenshot({path:"shots/automation-rtl-phone.png",fullPage:true});
});

for(const theme of ["light","dark"])test(`automation capture mid-drag ${theme}`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/automation?theme="+theme);
  const point=page.getByTestId("gain").getByRole("slider",{name:"Point 3"});
  const b=await point.boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
  await page.mouse.move(b.x+b.width/2+20,b.y+b.height/2+20,{steps:6});
  await page.getByTestId("gain").screenshot({path:`shots/automation-${theme}-phone-drag.png`});
  await page.mouse.up();
});
