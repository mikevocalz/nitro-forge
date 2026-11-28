import {test,expect} from "playwright/test";

// Spreadsheet cluster, rendered through React Native Web in Chromium.
// Proves web rendering and interaction only; no iOS/Android or screen reader run.
const open=async(page,query="")=>{
  await page.goto("/spreadsheet"+query);
  await page.getByRole("grid").first().waitFor();
};
const cell=(page,addr)=>page.getByRole("cell",{name:new RegExp("^"+addr+",")}).first();

test("I-01 a 1,048,576-row sheet renders a bounded window while scrolling",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await open(page);
  const before=await page.getByRole("cell").count();
  expect(before).toBeLessThan(400);
  // Scroll the body far down; the window moves, the cell count stays bounded.
  await page.evaluate(()=>{
    // The body ScrollView; the header/row-number panes are overflow:hidden mirrors.
    const scrollers=[...document.querySelectorAll("div")].filter(d=>d.scrollHeight>1_000_000&&
      ["auto","scroll"].includes(getComputedStyle(d).overflowY));
    scrollers[0].scrollTop=32*500_000;scrollers[0].dispatchEvent(new Event("scroll"));
  });
  await expect(cell(page,"A500001")).toBeAttached();
  expect(await page.getByRole("cell").count()).toBeLessThan(400);
});

test("I-02 dragging the fill handle and Ctrl+D both call onFillRange",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await open(page);
  const f2=await cell(page,"F2").boundingBox();
  const sx=f2.x+f2.width-2, sy=f2.y+f2.height-2;
  await page.mouse.move(sx,sy);await page.mouse.down();
  await page.mouse.move(sx,sy+f2.height*2,{steps:6});
  await page.mouse.up();
  await expect(page.getByTestId("fills")).toHaveText("fills 1");
  await expect(cell(page,"F4")).toHaveAccessibleName(/^F4, 151\.71/);
  // Keyboard: select B2:B4 and fill down from B2.
  await cell(page,"B2").click();
  const grid=page.getByRole("grid").first();
  await grid.focus();
  await page.keyboard.press("Shift+ArrowDown");await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("fills")).toHaveText("fills 2");
  await expect(cell(page,"B4")).toHaveAccessibleName(/^B4, 120/);
});

test("I-06 references are outlined in the grid and colored in the formula text",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await open(page);
  await expect(cell(page,"B5")).toHaveAccessibleName(/referenced by B2:B8/);
  await expect(cell(page,"C5")).toHaveAccessibleName(/referenced by C2:C8/);
  const colors=await page.getByTestId("formula").evaluate(el=>[...el.querySelectorAll("span,div")]
    .filter(n=>/^(B2:B8|C2:C8)$/.test(n.textContent)).map(n=>getComputedStyle(n).color));
  expect(colors).toHaveLength(2);
  expect(colors[0]).not.toBe(colors[1]);
});

test("I-08 sheet tabs select, add, rename with validation and engine errors, and remove",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await open(page);
  const tabs=page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await page.getByRole("tab",{name:"Q3 Plan"}).click();
  await expect(page.getByRole("tab",{name:"Q3 Plan"})).toHaveAttribute("aria-selected","true");
  await page.getByRole("tab",{name:"Q3 Plan"}).press("ArrowLeft");
  await expect(page.getByRole("tab",{name:"Summary"})).toHaveAttribute("aria-selected","true");
  await page.getByRole("button",{name:"New sheet"}).click();
  await expect(page.getByRole("tab",{name:"Sheet4"})).toBeVisible();
  await page.getByRole("button",{name:"Edit sheet"}).click();
  await page.getByRole("button",{name:"Rename"}).click();
  const input=page.getByRole("textbox",{name:"Rename sheet Summary"});
  await input.fill("q3 plan");await input.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(/already exists/);
  await input.fill("locked");await input.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("The engine refused that name.");
  await input.fill("Overview");await input.press("Enter");
  await expect(page.getByRole("tab",{name:"Overview"})).toBeVisible();
  // Protected tab: no rename/remove, an honest reason instead.
  await page.getByRole("tab",{name:/Audit/}).click();
  await expect(page.getByRole("button",{name:"Rename"})).toHaveCount(0);
  await expect(page.getByText("Unprotect this sheet to rename, move or remove it.")).toBeVisible();
  await page.getByRole("tab",{name:"Sheet4"}).click();
  const strip=page.getByTestId("tabs");
  await strip.getByRole("button",{name:"Remove",exact:true}).click();
  await expect(strip.getByText("Remove Sheet4?")).toBeVisible();
  await strip.getByRole("button",{name:"Remove",exact:true}).click();
  await expect(tabs).toHaveCount(3);
});

test("I-13 chart builder: type gallery, range errors and a live summary",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await open(page);
  const chart=page.getByTestId("chart");
  await chart.getByRole("radio",{name:"Line"}).click();
  await expect(chart.getByRole("radio",{name:"Line"})).toHaveAttribute("aria-checked","true");
  await expect(chart.getByText("2 series, 14 points; 7 cells have no number and are left out.")).toBeVisible();
  await chart.getByRole("textbox",{name:"Data range"}).fill("A1:ZZ999");
  await expect(chart.getByRole("alert")).toHaveText(/at most 4096 cells/);
  await expect(chart.getByRole("button",{name:"Insert chart"})).toBeDisabled();
  await chart.getByRole("textbox",{name:"Data range"}).fill("B1:B8");
  await expect(chart.getByText("1 series, 7 points.")).toBeVisible();
});

test("I-14 sparkline editor validates fields and draws in its cell",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await open(page);
  await expect(cell(page,"E2")).toHaveAccessibleName(/sparkline of B2:B8/);
  const spark=page.getByTestId("spark");
  await spark.getByRole("radio",{name:"Win/loss"}).click();
  await expect(spark.getByRole("checkbox",{name:"Shade negative values"})).toBeVisible();
  await spark.getByRole("textbox",{name:"Data range"}).fill("B2:C8");
  await expect(spark.getByRole("alert")).toHaveText("Use one row or one column of data.");
  await spark.getByRole("textbox",{name:"Data range"}).fill("B2:B8");
  await spark.getByRole("textbox",{name:"Show in cell"}).fill("E2:E3");
  await expect(spark.getByRole("alert")).toHaveText(/Enter one cell/);
  await expect(spark.getByRole("button",{name:"Apply"})).toBeDisabled();
});

test("I-17 freeze commands and a keyboard-adjustable split divider",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await open(page);
  const freeze=page.getByTestId("freeze");
  await freeze.getByRole("button",{name:"First column"}).click();
  await expect(freeze.getByText("Column A stays in view while you scroll.")).toBeVisible();
  await freeze.getByRole("button",{name:"At selection (F2)"}).click();
  await expect(freeze.getByText("Row 1 and columns A–E stay in view while you scroll.")).toBeVisible();
  await freeze.getByRole("button",{name:"Stacked"}).click();
  await expect(page.getByRole("grid")).toHaveCount(2);
  const divider=page.getByRole("slider",{name:/Split divider/});
  await expect(divider).toHaveAttribute("aria-valuenow","50");
  await divider.focus();await page.keyboard.press("ArrowDown");
  await expect(divider).toHaveAttribute("aria-valuenow","55");
  await freeze.getByRole("button",{name:"Remove split"}).click();
  await expect(page.getByRole("grid")).toHaveCount(1);
});

test("I-20 cards open, step and edit a field through the commit callback",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await open(page);
  const cards=page.getByTestId("cards");
  await expect(cards.getByText("7 records")).toBeVisible();
  await cards.getByRole("button",{name:"Jan",exact:true}).click();
  await expect(cards.getByRole("heading",{name:"Jan"})).toBeVisible();
  await cards.getByRole("button",{name:"Next record"}).click();
  await expect(cards.getByRole("heading",{name:"Feb"})).toBeVisible();
  await cards.getByRole("button",{name:"Sales: 135"}).click();
  const field=cards.getByRole("textbox",{name:"Edit Sales"});
  await field.fill("fail");await field.press("Enter");
  await expect(cards.getByRole("alert")).toHaveText("The engine rejected this value.");
  await field.fill("999");await field.press("Enter");
  await expect(cards.getByRole("button",{name:"Sales: 999"})).toBeVisible();
  await expect(cell(page,"B3")).toHaveAccessibleName(/^B3, 999/);
  await cards.getByRole("button",{name:"All records"}).click();
  await expect(cards.getByText("7 records")).toBeVisible();
});

// Review captures (not pixel goldens): light/dark at 390 and 834, plus RTL.
const sizes=[["phone",{width:390,height:844}],["tablet",{width:834,height:1194}]];
for(const theme of ["light","dark"])for(const [name,size] of sizes){
  test(`capture spreadsheet ${theme} ${name}`,async({page})=>{
    await page.emulateMedia({colorScheme:theme});
    await page.setViewportSize(size);
    await open(page,"?theme="+theme);
    await page.screenshot({path:`shots/spreadsheet-${theme}-${name}.png`,fullPage:true});
    await page.getByRole("button",{name:"Edit sheet"}).click();
    await page.getByTestId("sheet").screenshot({path:`shots/spreadsheet-${theme}-${name}-tabs-open.png`});
    await page.getByTestId("freeze").getByRole("button",{name:"Stacked"}).click();
    await page.getByTestId("sheet").screenshot({path:`shots/spreadsheet-${theme}-${name}-split.png`});
    await page.getByTestId("cards").getByRole("button",{name:"Jan",exact:true}).click();
    await page.getByTestId("cards").screenshot({path:`shots/spreadsheet-${theme}-${name}-card.png`});
  });
}
test("capture spreadsheet rtl phone",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await open(page,"?dir=rtl");
  await page.screenshot({path:"shots/spreadsheet-rtl-phone.png",fullPage:true});
});
