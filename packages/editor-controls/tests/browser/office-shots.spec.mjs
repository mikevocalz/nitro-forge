import {test} from "playwright/test";
// Review captures, not pixel goldens: CI fonts differ from local ones.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
for(const part of ["slides","document","pdf"])for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`office ${part} capture ${theme} ${name}`,async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
    await page.setViewportSize(size);
    await page.goto(`/office?part=${part}&theme=${theme}`);
    await page.getByTestId(part==="slides"?"canvas":part==="document"?"ribbon":"search").waitFor();
    await page.screenshot({path:`shots/office-${part}-${theme}-${name}.png`,fullPage:true});
    if(errors.length)throw new Error(errors.join("\n"));
  });
}
for(const part of ["slides","document","pdf"])test(`office ${part} capture rtl phone`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/office?part=${part}&dir=rtl`);
  await page.getByTestId(part==="slides"?"canvas":part==="document"?"ribbon":"search").waitFor();
  await page.screenshot({path:`shots/office-${part}-rtl-phone.png`,fullPage:true});
});
for(const theme of ["light","dark"])test(`office states capture ${theme} phone`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/office?part=pdf&theme=${theme}`);
  await page.getByTestId("search").getByRole("button",{name:"Search",exact:true}).click();
  await page.getByTestId("search").getByRole("button",{name:"Next match"}).focus();
  await page.keyboard.press("Tab");await page.keyboard.press("Shift+Tab");
  await page.screenshot({path:`shots/office-pdf-${theme}-phone-results.png`,fullPage:true});
  await page.goto(`/office?part=slides&theme=${theme}`);
  await page.getByRole("button",{name:/^Text box, Ridership/}).click();
  await page.getByRole("group",{name:"Slide"}).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Text box contents").waitFor();
  await page.screenshot({path:`shots/office-slides-${theme}-phone-editing.png`});
});
