import {test,expect} from "playwright/test";
const log=page=>page.getByTestId("ink-log");

test("tools are a radio group; picking one reports it once",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/ink");
  const group=page.getByRole("radiogroup",{name:"Tool"});
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.getByRole("radio",{name:"Pen"})).toHaveAttribute("aria-checked","true");
  await group.getByRole("radio",{name:"Eraser"}).click();
  await expect(group.getByRole("radio",{name:"Eraser"})).toHaveAttribute("aria-checked","true");
  await expect(log(page)).toHaveText("log tool eraser");
});
test("disabled redo explains itself instead of doing nothing silently",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/ink");
  await page.getByRole("button",{name:"Redo, unavailable"}).click();
  await expect(page.getByText("Nothing to redo")).toBeVisible();
  await expect(log(page)).toHaveText("log ");
  await page.getByRole("button",{name:"Undo"}).click();
  await expect(page.getByRole("button",{name:"Redo",exact:true})).toBeVisible();
  await expect(page.getByText("Nothing to redo")).toHaveCount(0);
});
test("size steps, color picks and the pressure switch report host intent",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/ink");
  await page.getByRole("button",{name:"Increase size"}).click();
  await expect(page.getByRole("slider",{name:"Size"})).toHaveAttribute("aria-valuetext","Large");
  await page.getByRole("radiogroup",{name:"Color"}).getByRole("radio",{name:"Red"}).click();
  await page.getByRole("switch",{name:"Pressure"}).click();
  await expect(page.getByRole("switch",{name:"Pressure"})).toHaveAttribute("aria-checked","false");
  await expect(log(page)).toHaveText("log size l, color red, pressure false");
});
test("keyboard shortcuts run while focus is inside the toolbar",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/ink");
  await page.getByRole("radio",{name:"Pen"}).focus();
  await page.keyboard.press("h");
  await page.keyboard.press("]");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(log(page)).toHaveText("log tool highlighter, size l, undo");
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await expect(page.getByText("Already the largest size")).toBeVisible();
});
test("every control keeps a 44pt target",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/ink");
  const toolbar=page.getByRole("toolbar",{name:"Ink tools"});
  for(const role of ["radio","button","switch"]){
    for(const el of await toolbar.getByRole(role).all()){
      const box=await el.boundingBox();
      if(box===null)continue; // scrolled out of the strip
      expect(box.width,await el.getAttribute("aria-label")).toBeGreaterThanOrEqual(44);
      expect(box.height,await el.getAttribute("aria-label")).toBeGreaterThanOrEqual(44);
    }
  }
});
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`capture ink ${theme} ${name}`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto("/ink?theme="+theme);
    await page.getByRole("toolbar",{name:"Ink tools"}).waitFor();
    await page.screenshot({path:`shots/ink-${theme}-${name}.png`});
    await page.getByRole("button",{name:"Redo, unavailable"}).click();
    await page.getByRole("radio",{name:"Eraser"}).focus();
    await page.keyboard.press("Shift+Tab"); // keyboard focus, so focus-visible rings draw
    await page.screenshot({path:`shots/ink-${theme}-${name}-notice-focus.png`});
  });
}
test("capture ink rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/ink?dir=rtl");
  await page.getByRole("toolbar",{name:"Ink tools"}).waitFor();
  await page.screenshot({path:"shots/ink-rtl-phone.png"});
});
