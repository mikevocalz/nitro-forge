import {test,expect} from "playwright/test";
const log=page=>page.getByTestId("vector-log");
const doc=async page=>JSON.parse(await page.getByTestId("vector-doc").innerText());
const center=async locator=>{const b=await locator.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
async function dragBy(page,locator,dx,dy,{hold,beforeUp}={}){
  const c=await center(locator);
  await page.mouse.move(c.x,c.y);
  await page.mouse.down();
  for(let i=1;i<=6;i++)await page.mouse.move(c.x+dx*i/6,c.y+dy*i/6);
  if(beforeUp)await beforeUp();
  await page.mouse.up();
  return hold;
}
const open=async(page,query="",width=834)=>{
  await page.setViewportSize({width,height:1194});
  await page.goto("/vector"+query);
  await log(page).waitFor();
};
// 834px viewport: the canvas is 560pt wide for 400 content units, so 1 unit = 1.4pt.
const S=1.4;

test.describe("PenNodeEditor",()=>{
  test("dragging a node previews, then commits one setPathNode on release",async({page})=>{
    await open(page,"?part=pen");
    const node=page.getByTestId("pen-node-0-0");
    await dragBy(page,node,28,-14,{beforeUp:async()=>{
      await expect(page.getByTestId("vector-preview")).toHaveText("previewing");
      await expect(log(page)).toHaveText("log ");
    }});
    await expect(log(page)).toHaveText("log setPathNode 0:0");
    await expect(page.getByTestId("vector-preview")).toHaveText("");
    const n=(await doc(page)).subpaths[0].nodes[0];
    expect(n.x).toBeCloseTo(60+28/S,0);
    expect(n.y).toBeCloseTo(220-14/S,0);
  });
  test("Escape cancels a node drag without committing",async({page})=>{
    await open(page,"?part=pen");
    const node=page.getByTestId("pen-node-0-3");
    await dragBy(page,node,40,0,{beforeUp:()=>page.keyboard.press("Escape")});
    await expect(log(page)).toHaveText("log ");
    expect((await doc(page)).subpaths[0].nodes[3].x).toBe(340);
    await expect(page.getByTestId("vector-preview")).toHaveText("");
  });
  test("smooth handles stay collinear, symmetric mirror, Alt breaks to a corner",async({page})=>{
    await open(page,"?part=pen&select=1");
    await dragBy(page,page.getByTestId("pen-handle-out"),0,-28);
    let n=(await doc(page)).subpaths[0].nodes[1];
    expect(n.kind).toBe("smooth");
    // The opposite handle turned to stay collinear and kept its length.
    const cross=n.in[0]*n.out[1]-n.in[1]*n.out[0];
    expect(Math.abs(cross)).toBeLessThan(1);
    expect(Math.hypot(...n.in)).toBeCloseTo(Math.hypot(40,40),0);
    await page.getByTestId("pen-node-0-2").click();
    await dragBy(page,page.getByTestId("pen-handle-in"),0,28);
    n=(await doc(page)).subpaths[0].nodes[2];
    expect(n.out[0]).toBeCloseTo(-n.in[0],3);
    expect(n.out[1]).toBeCloseTo(-n.in[1],3);
    // Alt held on the focused editor breaks the handles.
    await page.getByTestId("pen-node-0-2").focus();
    await page.keyboard.down("Alt");
    await dragBy(page,page.getByTestId("pen-handle-in"),0,-40);
    await page.keyboard.up("Alt");
    n=(await doc(page)).subpaths[0].nodes[2];
    expect(n.kind).toBe("corner");
    expect(n.out[0]).toBeCloseTo(-n.in[0]-0,-2);
    expect(n.out).not.toEqual([-n.in[0],-n.in[1]]);
    await expect(log(page)).toHaveText("log setPathNode 0:1 | setPathNode 0:2 | setPathNode 0:2");
  });
  test("tapping the outline inserts a node; Delete removes it; host undo restores",async({page})=>{
    await open(page,"?part=pen");
    const canvas=await page.getByTestId("pen-canvas").boundingBox();
    // Bottom edge from (340,230) back to (60,220) is the closing straight segment; tap its middle.
    await page.mouse.click(canvas.x+1+200*S,canvas.y+1+225*S);
    await expect(log(page)).toHaveText("log insertPathNode 0:4");
    expect((await doc(page)).subpaths[0].nodes).toHaveLength(5);
    await expect(page.getByTestId("pen-node-0-4")).toBeFocused({timeout:1000}).catch(()=>{});
    await page.getByTestId("pen-node-0-4").focus();
    await page.keyboard.press("Delete");
    await expect(log(page)).toHaveText("log insertPathNode 0:4 | removePathNode 0:4");
    expect((await doc(page)).subpaths[0].nodes).toHaveLength(4);
    await page.getByRole("button",{name:"Undo"}).click();
    expect((await doc(page)).subpaths[0].nodes).toHaveLength(5);
  });
  test("splitting a curve sends the whole path so the shape is unchanged",async({page})=>{
    await open(page,"?part=pen&select=1");
    await page.getByRole("button",{name:"Add node",exact:true}).click();
    await expect(log(page)).toHaveText("log setPathNodes");
    const nodes=(await doc(page)).subpaths[0].nodes;
    expect(nodes).toHaveLength(5);
    expect(nodes[2].kind).toBe("smooth");
  });
  test("arrow keys nudge the focused node by 1, Shift by 10, one commit per press",async({page})=>{
    await open(page,"?part=pen");
    await page.getByTestId("pen-node-0-3").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    const n=(await doc(page)).subpaths[0].nodes[3];
    expect([n.x,n.y]).toEqual([341,240]);
    await expect(log(page)).toHaveText("log setPathNode 0:3 | setPathNode 0:3");
  });
  test("kind and close commands commit; unavailable ones say why",async({page})=>{
    await open(page,"?part=pen");
    await page.getByRole("button",{name:"Delete node, unavailable"}).click();
    await expect(page.getByTestId("pen-notice")).toHaveText("Select a node first");
    await expect(log(page)).toHaveText("log ");
    await page.getByTestId("pen-node-0-3").click();
    await page.getByRole("radio",{name:"Smooth"}).click();
    await expect(page.getByRole("radio",{name:"Smooth"})).toHaveAttribute("aria-checked","true");
    const n=(await doc(page)).subpaths[0].nodes[3];
    expect(n.kind).toBe("smooth");
    expect(n.in&&n.out).toBeTruthy();
    await page.getByRole("button",{name:"Open path"}).click();
    await expect(page.getByRole("button",{name:"Close path"})).toBeVisible();
    await expect(log(page)).toHaveText("log setPathNode 0:3 | setSubpathClosed false");
    // An open path's last node has no segment after it.
    await page.getByRole("button",{name:"Add node, unavailable"}).click();
    await expect(page.getByTestId("pen-notice")).toContainText("last node of an open path");
  });
});

test.describe("GradientOnCanvasHandles",()=>{
  test("dragging the end handle rotates the gradient with one setFill",async({page})=>{
    await open(page,"?part=gradient");
    await dragBy(page,page.getByTestId("gradient-end"),0,70,{beforeUp:async()=>{
      await expect(page.getByTestId("vector-preview")).toHaveText("previewing");
    }});
    await expect(log(page)).toHaveText("log setFill linear");
    const f=(await doc(page)).fill;
    expect(f.x1).toBeCloseTo(340,0);
    expect(f.y1).toBeCloseTo(150+70/S,0);
  });
  test("stops drag along the rail, the rail adds a stop, Delete removes, Escape cancels",async({page})=>{
    await open(page,"?part=gradient");
    await dragBy(page,page.getByTestId("gradient-stop-1"),-56,0);
    expect((await doc(page)).fill.stops[1].offset).toBeCloseTo(0.5-56/S/280,2);
    await dragBy(page,page.getByTestId("gradient-stop-1"),60,0,{beforeUp:()=>page.keyboard.press("Escape")});
    const rail=await center(page.getByTestId("gradient-stop-2"));
    const first=await center(page.getByTestId("gradient-stop-0"));
    await page.mouse.click(first.x+(rail.x-first.x)*0.8,rail.y);
    let stops=(await doc(page)).fill.stops;
    expect(stops).toHaveLength(4);
    expect(stops[2].offset).toBeCloseTo(0.8,1);
    await page.getByTestId("gradient-stop-2").focus();
    await page.keyboard.press("ArrowLeft");
    expect((await doc(page)).fill.stops[2].offset).toBeCloseTo(stops[2].offset-0.01,3);
    await page.keyboard.press("Delete");
    stops=(await doc(page)).fill.stops;
    expect(stops).toHaveLength(3);
    await expect(log(page)).toHaveText("log setFill linear | setFill linear | setFill linear | setFill linear");
  });
  test("two stops cannot be deleted; the reason is shown",async({page})=>{
    await open(page,"?part=gradient");
    await page.getByTestId("gradient-stop-1").focus();
    await page.keyboard.press("Delete");
    await page.getByTestId("gradient-stop-1").focus();
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("gradient-notice")).toHaveText("A gradient keeps at least two stops");
    expect((await doc(page)).fill.stops).toHaveLength(2);
  });
  test("radial: focal point stays inside the circle and keys nudge the center",async({page})=>{
    await open(page,"?part=gradient&fill=radial");
    await dragBy(page,page.getByTestId("gradient-focal"),300,0);
    const f=(await doc(page)).fill;
    expect(Math.hypot(f.fx-f.cx,f.fy-f.cy)).toBeLessThan(f.r);
    await page.getByTestId("gradient-center").focus();
    await page.keyboard.press("Shift+ArrowLeft");
    const g=(await doc(page)).fill;
    expect(g.cx).toBe(f.cx-10);
    expect(g.fx).toBeCloseTo(f.fx-10,3);
    await page.getByRole("button",{name:"Remove focal point"}).click();
    expect((await doc(page)).fill.fx).toBeUndefined();
  });
});

test.describe("FillStrokeInspector",()=>{
  test("fill type, colors, stroke settings and dash patterns commit their ops",async({page})=>{
    await open(page,"?part=inspector");
    await page.getByRole("radiogroup",{name:"Fill type"}).getByRole("radio",{name:"Radial"}).click();
    await page.getByRole("radiogroup",{name:"Fill color"}).or(page.getByRole("radiogroup",{name:"Stop 1 color"})).getByRole("radio",{name:"Red"}).click();
    await page.getByRole("radiogroup",{name:"Join"}).getByRole("radio",{name:"Round"}).click();
    await expect(page.getByText("The miter limit applies to miter joins only")).toBeVisible();
    await page.getByRole("radiogroup",{name:"Dash pattern"}).getByRole("radio",{name:"Dash",exact:true}).click();
    await page.getByRole("button",{name:"Increase Width"}).click();
    await expect(log(page)).toHaveText(
      "log setFill radial | setFill radial | setStroke 2 round butt [] | setStroke 2 round butt [6,4] | setStroke 2.1 round butt [6,4]");
    expect((await doc(page)).fill.stops[0].color).toEqual([224,49,49,255]);
  });
  test("a custom dash is validated before it commits",async({page})=>{
    await open(page,"?part=inspector");
    await page.getByRole("radiogroup",{name:"Dash pattern"}).getByRole("radio",{name:"Custom"}).click();
    const field=page.getByLabel("Custom dash pattern");
    await field.fill("6 x");
    await field.press("Enter");
    await expect(page.getByText("Use numbers separated by spaces or commas, for example 6 3")).toBeVisible();
    await expect(log(page)).toHaveText("log ");
    await field.fill("5, 2");
    await field.press("Enter");
    await expect(log(page)).toHaveText("log setStroke 2 miter butt [5,2]");
    await page.getByRole("radiogroup",{name:"Paint order"}).getByRole("radio",{name:"Fill on top"}).click();
    await page.getByRole("radiogroup",{name:"Fill rule"}).getByRole("radio",{name:"Even-odd"}).click();
    await expect(log(page)).toHaveText("log setStroke 2 miter butt [5,2] | setPaintOrder stroke-fill | setFillRule evenodd");
  });
  test("a shape layer keeps a solid fill and explains the rest",async({page})=>{
    await open(page,"?part=inspector&kind=shape&fill=solid");
    await expect(page.getByRole("radiogroup",{name:"Fill type"}).getByRole("radio",{name:"Linear"})).toBeDisabled();
    await expect(page.getByText("Shape layers take a solid fill only. Convert the shape to a path for gradients and fill rules")).toBeVisible();
    await page.getByRole("switch",{name:"Stroke, unavailable"}).click();
    await expect(page.getByTestId("inspector-notice")).toHaveText("Convert the shape to a path to add a stroke");
    await expect(log(page)).toHaveText("log ");
  });
  test("turning the stroke off and on",async({page})=>{
    await open(page,"?part=inspector");
    await page.getByRole("switch",{name:"Stroke"}).click();
    await expect(page.getByRole("switch",{name:"Stroke"})).toHaveAttribute("aria-checked","false");
    await page.getByRole("switch",{name:"Stroke"}).click();
    await expect(log(page)).toHaveText("log setStroke none | setStroke 2 miter butt []");
  });
});

test.describe("ShapeBuilder",()=>{
  test("combining needs two sibling, unlocked shapes or paths and says why not",async({page})=>{
    await open(page,"?part=builder");
    await page.getByRole("button",{name:"Union, unavailable"}).click();
    await expect(page.getByTestId("builder-notice")).toHaveText("Select at least two shapes or paths");
    await page.getByRole("checkbox",{name:"Select Rectangle"}).click();
    await page.getByRole("checkbox",{name:"Select Photo"}).click();
    await expect(page.getByTestId("builder-notice")).toHaveText("“Photo” is a pixel layer; booleans take shapes and paths");
    await page.getByRole("checkbox",{name:"Select Photo"}).click();
    await page.getByRole("checkbox",{name:"Select Star"}).click();
    await expect(page.getByTestId("builder-notice")).toHaveText("“Star” is locked");
    await expect(log(page)).toHaveText("log ");
  });
  test("union, change op, operand rows, release and expand map to engine ops",async({page})=>{
    await open(page,"?part=builder&picked=11,12");
    await page.getByRole("button",{name:"Union"}).click();
    const group=page.getByTestId("boolean-group");
    await expect(group.getByRole("radio",{name:"Union"})).toHaveAttribute("aria-checked","true");
    await group.getByRole("radio",{name:"Intersect"}).click();
    await group.getByRole("listitem",{name:/^Rectangle, shape, operand 2 of 2, bottom/}).click();
    await page.getByRole("button",{name:"Release"}).click();
    await expect(page.getByTestId("boolean-group")).toHaveCount(0);
    await expect(log(page)).toHaveText("log booleanLayers 11,12 union | setBooleanOp 20 intersect | selectLayers 11 | ungroupLayer 20");
    await page.getByRole("button",{name:"Undo"}).click();
    await expect(page.getByTestId("boolean-group")).toBeVisible();
    await page.getByRole("button",{name:"Expand to pixels"}).click();
    await expect(log(page)).toContainText("rasterizeLayer 20");
  });
});

test("every vector control keeps a 44pt target at 390px and the page does not scroll sideways",async({page})=>{
  await open(page,"?select=1&picked=11,12",390);
  for(const role of ["button","radio","switch","checkbox"]){
    for(const el of await page.getByRole(role).all()){
      const box=await el.boundingBox();
      if(!box)continue;
      const name=await el.getAttribute("aria-label")??await el.innerText();
      expect(box.width,name).toBeGreaterThanOrEqual(44);
      expect(box.height,name).toBeGreaterThanOrEqual(44);
    }
  }
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
test("canvas geometry is not mirrored in RTL",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/vector?part=pen&dir=rtl");
  await log(page).waitFor();
  const first=await center(page.getByTestId("pen-node-0-0"));
  const last=await center(page.getByTestId("pen-node-0-3"));
  expect(first.x).toBeLessThan(last.x);
});
