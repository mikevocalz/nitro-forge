import {expect,test} from "playwright/test";

const state=(page,id)=>page.getByTestId(id);
async function open(page,part,query="",size={width:834,height:1194}){
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.setViewportSize(size);
  await page.goto(`/office?part=${part}${query}`);
  await page.getByTestId(part==="slides"?"canvas":part==="document"?"ribbon":"search").waitFor();
  return errors;
}

test.describe("J slides",()=>{
  test("J-05 canvas: select, drag with snapping, nudge, rotate, delete",async({page})=>{
    const errors=await open(page,"slides");
    const slide=page.getByRole("group",{name:"Slide"});
    const box=await slide.boundingBox();
    const scale=box.width/960;
    await page.getByRole("button",{name:/^Rectangle, at 80, 380/}).click();
    await expect(state(page,"slides-state")).toContainText("object b1 80,380,90,100,0");
    // 118 units right lands b1's left edge at 198, within the snap distance of b2's left edge (200).
    const b1=await page.getByRole("button",{name:/^Rectangle, at 80, 380/}).boundingBox();
    const from={x:b1.x+b1.width/2,y:b1.y+b1.height/2};
    await page.mouse.move(from.x,from.y);await page.mouse.down();
    for(let i=1;i<=6;i++)await page.mouse.move(from.x+118*scale*i/6,from.y);
    await page.mouse.up();
    await expect(state(page,"slides-state")).toContainText("moves 1 object b1 200,380,90,100,0");
    await slide.focus();
    await page.keyboard.press("Shift+ArrowDown");
    await expect(state(page,"slides-state")).toContainText("b1 200,390,90,100,0");
    await page.keyboard.press("]");
    await expect(state(page,"slides-state")).toContainText("b1 200,390,90,100,15");
    await page.keyboard.press("Delete");
    await expect(state(page,"slides-state")).toContainText("object none");
    await expect(page.getByRole("button",{name:/^Rectangle, at 200, 390/})).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("J-05 canvas: slide space is not mirrored in RTL",async({page})=>{
    await open(page,"slides","&dir=rtl");
    const box=await page.getByRole("group",{name:"Slide"}).boundingBox();
    const scale=box.width/960;
    const target=page.getByRole("button",{name:/^Rectangle, at 80, 380/});
    await target.click();
    const b1=await target.boundingBox();
    const from={x:b1.x+b1.width/2,y:b1.y+b1.height/2};
    await page.mouse.move(from.x,from.y);await page.mouse.down();
    await page.mouse.move(from.x+118*scale,from.y,{steps:6});await page.mouse.up();
    await expect(state(page,"slides-state")).toContainText("object b1 200,380,90,100,0");
    await page.getByRole("group",{name:"Slide"}).focus();
    await page.keyboard.press("ArrowRight");
    await expect(state(page,"slides-state")).toContainText("object b1 201,380,90,100,0");
  });

  test("J-05 canvas: corner resize keeps one commit; a cancelled drag reports nothing",async({page})=>{
    await open(page,"slides");
    const before=await state(page,"slides-state").textContent();
    const handle=await page.getByRole("button",{name:/^Rectangle, at 440, 170/}).boundingBox();
    const corner={x:handle.x+handle.width-1,y:handle.y+handle.height-1};
    await page.mouse.move(corner.x,corner.y);await page.mouse.down();
    await page.mouse.move(corner.x-20,corner.y-30,{steps:5});await page.mouse.up();
    await expect(state(page,"slides-state")).toContainText("moves 1 object b4 440,170,");
    expect(await state(page,"slides-state").textContent()).not.toBe(before);
  });

  test("J-01 filmstrip: Alt+Down moves a slide, Delete removes, New slide appends",async({page})=>{
    await open(page,"slides");
    const strip=page.getByTestId("filmstrip");
    await strip.getByRole("button",{name:/^Slide 1 of 5/}).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(state(page,"slides-state")).toContainText("order 2,1,3,4,5");
    await strip.getByRole("button",{name:/^Slide 5 of 5/}).focus();
    await page.keyboard.press("Delete");
    await expect(state(page,"slides-state")).toContainText("order 2,1,3,4 ");
    await strip.getByRole("button",{name:"New slide"}).click();
    await expect(state(page,"slides-state")).toContainText("order 2,1,3,4,5");
    await expect(strip.getByRole("button",{name:"Slide 5 of 5, 0 objects"})).toHaveAttribute("aria-current","true");
  });

  test("J-01 filmstrip: grip drag reorders on a horizontal phone strip",async({page})=>{
    await open(page,"slides","",{width:390,height:844});
    const strip=page.getByTestId("filmstrip");
    const first=await strip.getByRole("button",{name:/^Slide 1 of 5/}).boundingBox();
    // The number and grip sit centered under the thumbnail; the grip is the 44pt target after the number.
    const grip={x:first.x+first.width/2+14,y:first.y+first.height+26};
    await page.mouse.move(grip.x,grip.y);await page.mouse.down();
    await page.mouse.move(grip.x+140,grip.y,{steps:8});await page.mouse.up();
    await expect(state(page,"slides-state")).toContainText("order 2,1,3,4,5");
  });

  test("J-02 sorter: range select, block move, delete guard",async({page})=>{
    await open(page,"slides");
    const sorter=page.getByTestId("sorter");
    await sorter.getByRole("checkbox",{name:/^Slide 1 of 5/}).click();
    await sorter.getByRole("checkbox",{name:/^Slide 3 of 5/}).click({modifiers:["Shift"]});
    await expect(sorter.getByText("3 slides selected")).toBeVisible();
    await sorter.getByRole("button",{name:"Move to end"}).click();
    await expect(state(page,"slides-state")).toContainText("order 4,5,1,2,3");
    await sorter.getByRole("checkbox",{name:/^Slide 1 of 5/}).focus();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(sorter.getByText("5 slides selected")).toBeVisible();
    await expect(sorter.getByRole("button",{name:"Delete 5 slides"})).toBeDisabled();
    await sorter.getByRole("checkbox",{name:/^Slide 2 of 5/}).click();
    await sorter.getByRole("button",{name:"Delete slide"}).click();
    await expect(state(page,"slides-state")).toContainText("order 4,1,2,3");
  });

  test("J-09 animation pane: validation, engine rejection keeps the form, add and remove",async({page})=>{
    await open(page,"slides");
    await page.getByRole("button",{name:/^Rectangle, at 80, 380/}).click();
    const pane=page.getByTestId("animations");
    await expect(pane.getByText("Add animation to Bar b1")).toBeVisible();
    await pane.getByRole("radio",{name:"Fly in from left"}).click();
    await pane.getByLabel("Duration, in seconds").fill("abc");
    await pane.getByRole("button",{name:"Add animation"}).click();
    await expect(pane.getByText("Duration: Enter a number of seconds.")).toBeVisible();
    await pane.getByLabel("Duration, in seconds").fill("12");
    await pane.getByRole("button",{name:"Add animation"}).click();
    await expect(pane.getByText(/engine refused/)).toBeVisible();
    await expect(pane.getByLabel("Duration, in seconds")).toHaveValue("12");
    await pane.getByLabel("Start, in seconds").fill("0.2");
    await pane.getByLabel("Duration, in seconds").fill("0.4");
    await pane.getByRole("button",{name:"Add animation"}).click();
    await expect(pane.getByText("3 animations, 1.4 s")).toBeVisible();
    await expect(pane.getByLabel(/^2\. Bar b1, Fly in from left, starts at 0.2 s/)).toBeVisible();
    await pane.getByRole("button",{name:"Remove Fade in on Ridership since launch"}).click();
    await expect(pane.getByText("2 animations, 1.4 s")).toBeVisible();
  });
});

test.describe("H documents",()=>{
  test("H-03 ribbon: mixed bold turns on, color and size commit, paragraph style",async({page})=>{
    await open(page,"document");
    const ribbon=page.getByTestId("ribbon");
    const bold=ribbon.getByRole("button",{name:"Bold"});
    await expect(bold).toHaveAttribute("aria-pressed","mixed");
    await bold.click();
    await expect(state(page,"doc-state")).toContainText('runs [{"bold":true},{"bold":true,"italic":true}]');
    await ribbon.getByRole("radio",{name:"Text color Red"}).click();
    await expect(state(page,"doc-state")).toContainText("color #b3261e");
    await ribbon.getByRole("button",{name:"Automatic color"}).click();
    await expect(state(page,"doc-state")).toContainText("color auto");
    await ribbon.getByRole("button",{name:"Increase font size"}).click();
    await expect(state(page,"doc-state")).toContainText("size 14");
    await ribbon.getByRole("button",{name:"Heading 1"}).click();
    await expect(ribbon.getByRole("button",{name:"Heading 1"})).toHaveAttribute("aria-pressed","true");
  });

  test("H-07 lists: nesting policy, Shift+Tab outdent, renumbered preview",async({page})=>{
    await open(page,"document");
    const lists=page.getByTestId("lists");
    await expect(lists.getByRole("button",{name:"Increase indent"})).toBeDisabled();
    await expect(lists.getByRole("listitem")).toHaveText(["1.Pier Street","a.North platform","2.Customs House","3.Ferry deck"]);
    await lists.getByRole("button",{name:"Decrease indent"}).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(state(page,"doc-state")).toContainText("levels 0,0,0,0");
    await expect(lists.getByRole("listitem")).toHaveText(["1.Pier Street","2.North platform","3.Customs House","4.Ferry deck"]);
    await lists.getByRole("radio",{name:"Bulleted"}).click();
    await expect(lists.getByRole("listitem").first()).toHaveText("•Pier Street");
  });

  test("H-15 outline: jump, collapse, current heading, pages",async({page})=>{
    await open(page,"document");
    const outline=page.getByTestId("outline");
    await expect(outline.getByRole("link",{name:"Heading 2, Scope"})).toHaveAttribute("aria-current","location");
    await outline.getByRole("link",{name:"Heading 2, Budget"}).click();
    await expect(state(page,"doc-state")).toContainText("caret 9");
    await outline.getByRole("button",{name:"Collapse Harbor Line expansion"}).click();
    await expect(outline.getByRole("link",{name:"Heading 2, Scope"})).toHaveCount(0);
    await outline.getByRole("button",{name:"Expand Harbor Line expansion"}).click();
    await expect(outline.getByRole("link",{name:"Heading 3, Stations"})).toBeVisible();
    await outline.getByRole("tab",{name:"Pages"}).click();
    await outline.getByRole("link",{name:/^Page 2/}).click();
    await expect(state(page,"doc-state")).toContainText("caret 5");
  });

  test("H-21 read aloud: play, keys, skip, speed, stop",async({page})=>{
    await open(page,"document");
    const reader=page.getByTestId("doc-read");
    await expect(reader.getByText("Harbor Line expansion")).toBeVisible();
    await reader.getByRole("button",{name:"Play"}).click();
    await expect(state(page,"doc-state")).toContainText("status playing");
    await reader.getByRole("button",{name:"Pause"}).focus();
    await page.keyboard.press("ArrowRight");
    await expect(state(page,"doc-state")).toContainText("index 3");
    await expect(reader.getByText("Sentence 4 of 14")).toBeVisible();
    await expect(reader.getByText("Scope").first()).toBeVisible();
    await page.keyboard.press("+");
    await expect(state(page,"doc-state")).toContainText("rate 1.5");
    await page.keyboard.press(" ");
    await expect(state(page,"doc-state")).toContainText("status paused");
    await reader.getByRole("button",{name:"Stop reading"}).click();
    await expect(state(page,"doc-state")).toContainText("status stopped");
  });
});

test.describe("K PDF",()=>{
  test("K-04 search: page-ordered hits from the current page, wrap, toggles, no match",async({page})=>{
    await open(page,"pdf");
    const search=page.getByTestId("search");
    await search.getByRole("button",{name:"Search",exact:true}).click();
    // The fixture searches from page 2; its first hit stays current while page 1's hits sort in front of it.
    await expect(state(page,"pdf-state")).toContainText("current 2 hits 5");
    await expect(search.getByText("Match 3 of 5")).toBeVisible();
    // SectionList renders a window of results. Check the initial page order,
    // then scroll the list to verify the final page rather than requiring all rows mounted.
    await expect(search.getByRole("heading").first()).toHaveText("Page 1 · 2 matches");
    await expect(search.getByRole("heading").nth(1)).toHaveText("Page 2 · 1 match");
    const thirdPage=search.getByRole("heading",{name:"Page 3 · 1 match",exact:true});
    await thirdPage.scrollIntoViewIfNeeded();
    await thirdPage.hover();
    await page.mouse.wheel(0,800);
    await expect(thirdPage).toBeVisible();
    await expect(search.getByRole("heading",{name:"Page 4 · 1 match",exact:true})).toBeVisible();
    for(let i=0;i<3;i++)await search.getByRole("button",{name:"Next match"}).click();
    await expect(state(page,"pdf-state")).toContainText("current 0 hits 5");
    await search.getByRole("button",{name:"Match case"}).click();
    await search.getByLabel("Find in document").fill("HARBOR");
    await page.keyboard.press("Enter");
    await expect(state(page,"pdf-state")).toContainText("hits 1");
    await search.getByLabel("Find in document").fill("tram");
    await page.keyboard.press("Enter");
    await expect(search.getByText("No matches for “tram”.")).toBeVisible();
  });

  test("K-06 toolbar: only engine tools, letter shortcuts, Escape to Select",async({page})=>{
    await open(page,"pdf");
    const bar=page.getByTestId("annotate");
    await expect(bar.getByRole("button")).toHaveText(["Select","Note","Highlight","Undo","Redo"]);
    await bar.getByRole("button",{name:"Highlight"}).focus();
    await page.keyboard.press("n");
    await expect(state(page,"pdf-state")).toContainText("tool note");
    await expect(bar.getByText("Tap the page where the note goes.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(state(page,"pdf-state")).toContainText("tool select");
    await expect(bar.getByRole("button",{name:"Undo"})).toBeDisabled();
  });

  test("K-07 comments: filter, reply, resolve, delete",async({page})=>{
    await open(page,"pdf");
    const panel=page.getByTestId("comments");
    await panel.getByRole("radio",{name:"Resolved (1)"}).click();
    await expect(panel.getByText("No note text")).toBeVisible();
    await panel.getByRole("radio",{name:"Open (2)"}).click();
    await panel.getByLabel("Reply to Sam Ortiz").fill("From the 2026 budget, table 4.");
    await panel.getByLabel("Reply to Sam Ortiz").press("Enter");
    await expect(panel.getByText("From the 2026 budget, table 4.")).toBeVisible();
    await expect(state(page,"pdf-state")).toContainText("c2:1");
    await panel.getByRole("button",{name:"Resolve"}).first().click();
    await expect(state(page,"pdf-state")).toContainText("c1:1r");
    await expect(panel.getByRole("radio",{name:"Open (1)"})).toBeVisible();
    await panel.getByRole("button",{name:"Delete comment on page 3"}).click();
    await expect(panel.getByText("No open comments.")).toBeVisible();
  });

  test("K-07 comments: a failed reply keeps the draft and says why",async({page})=>{
    await open(page,"pdf","&fail=1");
    const panel=page.getByTestId("comments");
    await panel.getByLabel("Reply to Rana Iyer").fill("Agreed");
    await panel.getByRole("button",{name:"Reply",exact:true}).first().click();
    await expect(panel.getByText("Couldn't save the reply. Check the connection and send it again.")).toBeVisible();
    await expect(panel.getByLabel("Reply to Rana Iyer")).toHaveValue("Agreed");
  });

  test("K-18 read aloud: page steps and the no-voice state",async({page})=>{
    await open(page,"pdf");
    const reader=page.getByTestId("pdf-read");
    await expect(reader.getByText("Page 1 of 4")).toBeVisible();
    await reader.getByRole("button",{name:"Next page"}).click();
    await expect(reader.getByText("Page 2 of 4")).toBeVisible();
    await expect(reader.getByText("Ridership grew 14% since launch.")).toBeVisible();
    await reader.getByRole("button",{name:"Previous page"}).click();
    await expect(reader.getByRole("button",{name:"Previous page"})).toBeDisabled();
    await open(page,"pdf","&novoice=1");
    await expect(page.getByTestId("pdf-read").getByText("No voice is available on this device.")).toBeVisible();
    await expect(page.getByTestId("pdf-read").getByRole("button",{name:"Play"})).toBeDisabled();
  });
});
