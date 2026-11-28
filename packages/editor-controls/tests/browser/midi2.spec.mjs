import {expect,test} from "playwright/test";

// Velocity line tool, ramp and MIDI channel in React Native Web: real mouse
// drags and keys against the controlled components; the fixture stands in
// for the engine's setVelocities / setNoteChannel ops.
const log=page=>page.getByTestId("log");
const lines=async page=>(await log(page).innerText()).split("\n").filter(Boolean);
const batch=entry=>entry.replace(/^velocities /,"").split(",").map(p=>p.split(":").map(Number));

async function draw(page,from,to,{escape=false}={}){
  const layer=page.getByTestId("lane-draw");
  await layer.scrollIntoViewIfNeeded();
  const box=await layer.boundingBox();
  const p=([px,fy])=>[box.x+px,box.y+fy*box.height];
  const [x0,y0]=p(from),[x1,y1]=p(to);
  await page.mouse.move(x0,y0);await page.mouse.down();
  await page.mouse.move((x0+x1)/2,(y0+y1)/2,{steps:5});
  await page.mouse.move(x1,y1,{steps:5});
  if(escape)await page.keyboard.press("Escape");
  await page.mouse.up();
}
// Bars sit at 0, 48 ... 240 pt from the draw layer's left edge (0.1 pt/tick, no scroll).
const X=pt=>pt;

test("line draw: preview while dragging, one batch on release, decreasing left to right",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/midi2");
  const layer=page.getByTestId("lane-draw");
  await layer.scrollIntoViewIfNeeded();
  const box=await layer.boundingBox();
  await page.mouse.move(box.x+2,box.y+2);await page.mouse.down();
  await page.mouse.move(box.x+242,box.y+box.height-2,{steps:8});
  await expect(log(page)).toHaveText("");
  await expect(page.getByRole("slider",{name:"Velocity of C4 note 1"})).not.toHaveAttribute("aria-valuenow","100");
  await page.mouse.up();
  await expect(log(page)).toHaveText(/^velocities /);
  const entries=await lines(page);
  expect(entries).toHaveLength(1);
  const b=batch(entries[0]);
  expect(b.map(([i])=>i)).toEqual([0,1,2,3,4,5]);
  for(let k=1;k<b.length;k++)expect(b[k][1]).toBeLessThan(b[k-1][1]);
  expect(b[0][1]).toBeGreaterThan(120);expect(b[5][1]).toBeLessThan(8);
  await expect(page.getByRole("slider",{name:"Velocity of C4 note 1"})).toHaveAttribute("aria-valuenow",String(b[0][1]));
});

test("line draw: Escape mid-drag cancels with no commit and restores the bars",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/midi2");
  await draw(page,[X(2),0.05],[X(242),0.95],{escape:true});
  await page.waitForTimeout(200);
  await expect(log(page)).toHaveText("");
  await expect(page.getByRole("slider",{name:"Velocity of C4 note 1"})).toHaveAttribute("aria-valuenow","100");
});

test("line draw: a line that matches the current heights commits nothing",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/midi2");
  // Off to the right of the last note: hits nothing.
  await draw(page,[X(300),0.2],[X(380),0.8]);
  await page.waitForTimeout(200);
  await expect(log(page)).toHaveText("");
});

test("line draw in RTL: reversed drag still gives earlier notes the left end",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/midi2?dir=rtl");
  await draw(page,[X(242),0.95],[X(2),0.05]);
  await expect(log(page)).toHaveText(/^velocities /);
  const b=batch((await lines(page))[0]);
  expect(b[0][1]).toBeGreaterThan(b[5][1]);
});

test("rejected batch keeps the committed velocities",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/midi2?reject=1");
  await draw(page,[X(2),0.05],[X(242),0.95]);
  await expect(log(page)).toHaveText("rejected 6");
  await expect(page.getByRole("slider",{name:"Velocity of C4 note 1"})).toHaveAttribute("aria-valuenow","100");
});

test("keyboard: tool radios, ramp from the selected note, bars tool restores single drags",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/midi2");
  await expect(page.getByText("select a note to ramp from it")).toBeVisible();
  await page.getByRole("slider",{name:"Velocity of C4 note 1"}).focus();
  const end=page.getByRole("slider",{name:"Ramp end velocity"});
  await expect(end).toBeVisible();
  await end.focus();
  await page.keyboard.press("Home");
  await expect(end).toHaveAttribute("aria-valuetext","velocity 0");
  await page.getByRole("button",{name:"Ramp"}).focus();
  await page.keyboard.press("Enter");
  await expect(log(page)).toHaveText("velocities 1:67,2:33,3:0");
  await page.getByTestId("lane").getByRole("radio",{name:"Bars"}).click();
  await expect(log(page)).toContainText("tool bars");
  await expect(page.getByTestId("lane-draw")).toHaveCount(0);
  await expect(page.getByRole("slider",{name:"Ramp end velocity"})).toHaveCount(0);
});

test("channel: picker for the selected note, labels name channels, keys and buttons commit once",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/midi2");
  await expect(page.getByRole("slider",{name:/^MIDI channel of/})).toHaveCount(0);
  const note=page.getByRole("button",{name:"D4, beat 3, 0.50 beats long, velocity 90, channel 10"});
  await note.focus();
  const picker=page.getByRole("slider",{name:"MIDI channel of D4 note 5"});
  await expect(picker).toHaveAttribute("aria-valuetext","Channel 10");
  await picker.focus();
  await page.keyboard.press("ArrowUp");
  await expect(log(page)).toHaveText("channel 4 10");
  await expect(picker).toHaveAttribute("aria-valuetext","Channel 11");
  await page.keyboard.press("End");
  await page.keyboard.press("End");
  await expect(log(page)).toHaveText("channel 4 10\nchannel 4 15");
  const minus=picker.getByText("−");
  await minus.click();
  await expect(log(page)).toContainText("channel 4 14");
  expect((await lines(page)).length).toBe(3);
  const off=page.getByRole("slider",{name:"Locked channel"});
  await expect(off).toHaveAttribute("aria-valuetext","Channel 4");
  await off.focus();
  await page.keyboard.press("ArrowUp");
  await expect(log(page)).not.toContainText("never");
});

test("targets are at least 44 px and the phone layout does not scroll sideways",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/midi2");
  await page.getByRole("slider",{name:"Velocity of C4 note 1"}).focus();
  const lane=page.getByTestId("lane");
  const boxes=[
    lane.getByRole("radio",{name:"Bars"}),lane.getByRole("radio",{name:"Line"}),page.getByRole("button",{name:"Ramp"}),
    page.getByRole("slider",{name:"Ramp end velocity"}).getByText("+"),
    page.getByRole("slider",{name:"Ramp length in notes"}).getByText("−"),
  ];
  for(const b of boxes){
    // Text sits inside its Pressable; measure the pressable parent when given a text.
    const handle=await b.elementHandle();
    const box=await handle.evaluate(el=>{const t=el.getAttribute("role")?el:el.parentElement;const r=t.getBoundingClientRect();return {w:r.width,h:r.height};});
    expect(box.w,"width").toBeGreaterThanOrEqual(44);expect(box.h,"height").toBeGreaterThanOrEqual(44);
  }
  const no=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(no,"no horizontal page scroll").toBeLessThanOrEqual(0);
});
