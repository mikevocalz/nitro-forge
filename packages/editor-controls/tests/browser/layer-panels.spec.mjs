import {test,expect} from "playwright/test";
const log=page=>page.getByTestId("panel-log");
const phone={width:390,height:844};
const center=async loc=>{const b=await loc.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
const drag=async(page,from,dx,dy,{escape=false}={})=>{
  await page.mouse.move(from.x,from.y);
  await page.mouse.down();
  for(let i=1;i<=8;i++)await page.mouse.move(from.x+dx*i/8,from.y+dy*i/8);
  if(escape)await page.keyboard.press("Escape");
  await page.mouse.up();
};

test.beforeEach(async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  page.errors=errors;
});
test.afterEach(async({page})=>{expect(page.errors).toEqual([]);});

test("thumbnails: ready pixels, loading, empty and couldn't-render are distinct",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels");
  const states=page.getByTestId("thumb-states");
  await expect(states.getByRole("img",{name:"Ready",exact:true}).locator('img[src^="data:image/png"]')).toHaveCount(1);
  await expect(states.getByRole("img",{name:"Loading, loading preview"})).toHaveAttribute("aria-busy","true");
  await expect(states.getByRole("img",{name:"Empty layer, empty"})).toBeVisible();
  const failed=states.getByRole("img",{name:"Failed layer, couldn't render preview"});
  await expect(failed).toBeVisible();
  await expect(failed.getByText("Couldn't render")).toBeVisible();
  await failed.getByRole("button",{name:"Retry preview"}).click();
  await expect(failed.getByText("Couldn't render")).toBeVisible();
  // Layer rows use the same component, decoratively: the row label speaks for it.
  await expect(page.locator('[data-testid="layer-stack"] img[src^="data:image/png"]')).toHaveCount(4);
});

test("a new revision keeps the previous preview until the new one arrives",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels?delay=700");
  const mask=page.getByRole("img",{name:/^Mask of Warm tint/});
  await expect(mask).toHaveAccessibleName("Mask of Warm tint");
  await page.getByRole("switch",{name:"Inverted"}).click();
  await expect(mask).toHaveAccessibleName("Mask of Warm tint, updating preview");
  await expect(mask.locator('img[src^="data:image/png"]')).toHaveCount(1);
  await expect(mask).toHaveAccessibleName("Mask of Warm tint",{timeout:3000});
  await expect(log(page)).toHaveText('log invertMask {"id":"tint"}');
});

test("mask editor: enable, undo, delete, then create from a selection only once one exists",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels");
  const enabled=page.getByRole("switch",{name:"Enabled"});
  await expect(enabled).toHaveAttribute("aria-checked","true");
  await enabled.click();
  await expect(enabled).toHaveAttribute("aria-checked","false");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(enabled).toHaveAttribute("aria-checked","true");
  await page.getByRole("button",{name:"Delete mask"}).click();
  await expect(page.getByText("Warm tint has no mask. Start one:")).toBeVisible();
  const fromSelection=page.getByRole("button",{name:"From selection, unavailable"});
  await fromSelection.click();
  await expect(page.getByText("Make a selection first")).toBeVisible();
  await page.getByRole("button",{name:"Make selection"}).click();
  await page.getByRole("button",{name:"From selection",exact:true}).click();
  await expect(log(page)).toHaveText('log setMaskEnabled {"id":"tint","enabled":false} | undo | '+
    'removeMask {"id":"tint","apply":false} | addMask {"id":"tint","fill":"selection"}');
});

test("refine: unavailable at zero, one refineMask with the typed amounts, keyboard Apply",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels");
  await expect(page.getByRole("button",{name:"Refine mask, unavailable"})).toBeVisible();
  await expect(page.getByText("Set a feather or grow amount first")).toBeVisible();
  const feather=page.getByLabel("Feather value");
  await feather.fill("12");
  await feather.press("Enter");
  await page.getByRole("slider",{name:"Grow"}).focus();
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button",{name:"Refine mask",exact:true}).click();
  await expect(log(page)).toHaveText('log draft {"feather":12,"grow":0} | draft {"feather":12,"grow":-1} | '+
    'refineMask {"id":"tint","feather":12,"grow":-1}');
  await expect(page.getByRole("button",{name:"Refine mask, unavailable"})).toBeVisible();
  await page.getByRole("button",{name:"Apply mask"}).focus();
  await page.keyboard.press("Enter");
  await expect(log(page)).toContainText('removeMask {"id":"tint","apply":true}');
});

test("locked layers keep every mask control visible with the reason",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels");
  await page.getByRole("button",{name:/^Corrupt import, Pixel layer/}).click();
  await expect(page.getByText("Unlock the layer to edit its mask")).toBeVisible();
  for(const name of ["Reveal all","Hide all","From selection"])
    await expect(page.getByRole("button",{name:name+", unavailable"})).toBeVisible();
  await page.getByRole("button",{name:"Reveal all, unavailable"}).click();
  await expect(log(page)).toHaveText("log ");
});

test("clipping: the bottom layer explains itself; clipping a layer re-bases the ones above",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels");
  await expect(page.getByRole("button",{name:/^Warm tint, Pixel layer, clipped to Photo/})).toBeVisible();
  await page.getByRole("button",{name:/^Background, Pixel layer/}).click();
  await expect(page.getByRole("switch",{name:"Clip to layer below, unavailable"})).toBeVisible();
  await expect(page.getByText("The bottom layer has no layer below to clip to")).toBeVisible();
  await page.getByRole("button",{name:/^Photo, Pixel layer/}).click();
  const toggle=page.getByRole("switch",{name:"Clip to Blank"});
  await expect(toggle).toHaveAttribute("aria-checked","false");
  await toggle.click();
  await expect(log(page)).toHaveText('log setClipped {"id":"photo","clipped":true}');
  await expect(page.getByRole("button",{name:/^Photo, Pixel layer, clipped to Blank/})).toBeVisible();
  await expect(page.getByRole("button",{name:/^Warm tint, Pixel layer, clipped to Blank/})).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByRole("button",{name:/^Warm tint, Pixel layer, clipped to Photo/})).toBeVisible();
});

test("artboards: add beside the others, rename with F2, reorder with Alt+arrow, remove with Delete",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels?only=boards");
  await page.getByRole("button",{name:"Add artboard"}).click();
  await expect(page.getByRole("button",{name:/^Artboard 1, 390 by 844 pixels, 4 of 4/})).toBeVisible();
  const phoneTile=page.getByRole("button",{name:/^Phone, 390 by 844/});
  await phoneTile.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button",{name:/^Tablet, 834 by 1194/})).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("F2");
  const name=page.getByLabel("Name for Phone");
  await name.fill("Phone small");
  await name.press("Enter");
  const renamed=page.getByRole("button",{name:/^Phone small, 390 by 844 pixels, 1 of 4/});
  await renamed.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByRole("button",{name:/^Phone small, 390 by 844 pixels, 2 of 4/})).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button",{name:/^Phone small/})).toHaveCount(0);
  await expect(log(page)).toHaveText('log addArtboard {"name":"Artboard 1","x":2964,"y":0,"w":390,"h":844} | '+
    'updateArtboard {"id":"a1","name":"Phone small"} | moveArtboard {"id":"a1","to_index":1} | select a1 | removeArtboard {"id":"a1"}');
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByRole("button",{name:/^Phone small, 390 by 844 pixels, 2 of 4/})).toBeVisible();
});

test("artboards: dragging the grip reorders once on release; Escape cancels",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels?only=boards");
  const grip=page.getByLabel("Reorder Phone");
  await drag(page,await center(grip),0,140,{escape:true});
  await expect(log(page)).toHaveText("log ");
  await drag(page,await center(grip),0,140);
  await expect(log(page)).toHaveText('log moveArtboard {"id":"a1","to_index":2}');
});

test("artboards grid: two columns at 390, a drag right lands one cell over",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels?only=boards&grid=1");
  const tablet=await page.getByRole("button",{name:/^Tablet, 834/}).boundingBox();
  const phoneBox=await page.getByRole("button",{name:/^Phone, 390/}).boundingBox();
  expect(Math.abs(tablet.y-phoneBox.y)).toBeLessThan(2);
  expect(tablet.x).toBeGreaterThan(phoneBox.x+phoneBox.width);
  await drag(page,await center(page.getByLabel("Reorder Phone")),tablet.x-phoneBox.x,0);
  await expect(log(page)).toHaveText('log moveArtboard {"id":"a1","to_index":1}');
});

test("compare split: arrow keys and a mouse drag commit once; Escape restores",async({page})=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto("/layer-panels?only=boards");
  const divider=page.getByRole("slider",{name:"Split position"});
  await expect(divider).toHaveAttribute("aria-valuetext","50% snapshot, 50% current");
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow","41");
  const start=await center(divider);
  await drag(page,start,-80,0,{escape:true});
  await expect(divider).toHaveAttribute("aria-valuenow","41");
  await drag(page,await center(divider),60,0);
  await expect(log(page)).toHaveText(/^log split 0\.51 \| split 0\.41 \| split 0\.5\d+$/);
});

test("compare modes: overlay opacity commits through the scrubber; a missing image says so",async({page})=>{
  await page.setViewportSize(phone);
  await page.goto("/layer-panels?only=boards");
  await page.getByRole("radio",{name:"Overlay"}).click();
  await expect(page.getByRole("img",{name:"Snapshot at 50% over current"})).toBeVisible();
  await page.getByRole("button",{name:"Increase Snapshot opacity"}).click();
  await expect(page.getByRole("img",{name:"Snapshot at 51% over current"})).toBeVisible();
  await expect(log(page)).toHaveText("log mode overlay | overlay 0.51");
  await page.goto("/layer-panels?only=boards&compare=missing");
  await expect(page.getByText("No snapshot image yet")).toBeVisible();
  await page.getByRole("radio",{name:"Reference"}).click();
  await expect(page.getByRole("img",{name:"Current image"})).toBeVisible();
});

test("every control in the panels keeps a 44pt target",async({page})=>{
  for(const size of [phone,{width:834,height:1194}]){
    await page.setViewportSize(size);
    await page.goto("/layer-panels");
    await page.getByTestId("mask-editor").waitFor();
    await page.getByTestId("compare").getByRole("slider",{name:"Split position",exact:true}).waitFor();
    for(const scope of [page.getByTestId("mask-editor"),page.getByTestId("artboards"),page.getByTestId("compare")]){
      // Read one layout snapshot per panel instead of one browser round trip per edge/name.
      const targets=await scope.evaluate(root=>[...root.querySelectorAll('button,[role="button"],[role="switch"],[role="slider"],[role="radio"]')].filter(node=>!node.closest('[aria-hidden="true"]')&&getComputedStyle(node).visibility!=="hidden").map(node=>{const box=node.getBoundingClientRect();return {name:node.getAttribute("aria-label")??node.getAttribute("role")??"button",width:box.width,height:box.height};}).filter(box=>box.width>0&&box.height>0));
      expect(targets.length).toBeGreaterThan(0);
      for(const box of targets){expect(box.width,box.name).toBeGreaterThanOrEqual(44);expect(box.height,box.name).toBeGreaterThanOrEqual(44);}
    }
  }
});
