import {test,expect} from "playwright/test";

// A gap nitro-forge's Design Studio found on NYC-Tron UI v0.1.0-alpha.2:
// LayerStack rows overflowing narrow panels. The TabBar and Select checks of
// this page stayed in NYC-Tron UI's packages/ui/tests/browser lane.
const inside=async(child,parent)=>{
  const c=await child.boundingBox(),p=await parent.boundingBox();
  return c.x>=p.x-0.5&&c.x+c.width<=p.x+p.width+0.5;
};

for(const width of [320,360,390]){
  test(`layer rows fit a ${width}pt panel with name and remove visible`,async({page})=>{
    await page.setViewportSize({width:width+64,height:900});
    await page.goto("/studio-gaps?w="+width);
    const panel=page.getByTestId("layer-panel");
    for(const name of ["Headline","Badge","Skyline"]){
      const remove=page.getByRole("button",{name:"Remove "+name,exact:true});
      expect(await inside(remove,panel),`Remove ${name} inside the panel`).toBe(true);
      expect(await page.getByText(name,{exact:true}).isVisible()).toBe(true);
    }
    const slider=page.getByRole("slider",{name:"Badge opacity"});
    const readout=page.getByRole("button",{name:/^Badge opacity, 80%$/});
    if(width>=380){
      await expect(slider).toBeVisible();
      await expect(readout).toHaveCount(0);
    }else{
      await expect(readout).toBeVisible();
      await expect(slider).toHaveCount(0);
    }
  });
}

test("narrow rows: the readout opens a scrubber that previews, commits once and restores focus",async({page})=>{
  await page.setViewportSize({width:400,height:900});
  await page.goto("/studio-gaps?w=320");
  const readout=page.getByRole("button",{name:/^Badge opacity, 80%$/});
  await expect(readout).toHaveAttribute("aria-expanded","false");
  await readout.click();
  const dialog=page.getByRole("dialog",{name:"Badge opacity"});
  await expect(dialog).toBeVisible();
  const scale=dialog.getByRole("slider",{name:"Badge opacity"});
  await scale.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("state")).toContainText("commits badge=0.81");
  await expect(page.getByRole("button",{name:/^Badge opacity, 81%$/})).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button",{name:/^Badge opacity, 81%$/})).toBeFocused();
});

test("a locked row's readout is disabled",async({page})=>{
  await page.setViewportSize({width:400,height:900});
  await page.goto("/studio-gaps?w=320");
  await expect(page.getByRole("button",{name:/^Skyline opacity, 100%$/})).toBeDisabled();
});

// Review captures at the widths Forge docks this panel at, light and dark, LTR and RTL.
for(const theme of ["light","dark"])for(const width of [320,360,390]){
  test(`capture studio gaps ${theme} ${width}`,async({page})=>{
    await page.emulateMedia({colorScheme:theme});
    await page.setViewportSize({width:width+64,height:1100});
    await page.goto(`/studio-gaps?w=${width}&theme=${theme}`);
    await page.getByTestId("layer-panel").screenshot({path:`shots/studio-layers-${theme}-${width}.png`});
    if(width===320){
      await page.getByRole("button",{name:/^Badge opacity/}).click();
      await page.getByRole("dialog",{name:"Badge opacity"}).waitFor();
      await page.screenshot({path:`shots/studio-layers-${theme}-320-popover.png`});
      await page.keyboard.press("Escape");
    }
  });
}
test("capture studio gaps rtl 320",async({page})=>{
  await page.setViewportSize({width:384,height:1100});
  await page.goto("/studio-gaps?w=320&dir=rtl");
  await page.getByTestId("layer-panel").screenshot({path:"shots/studio-layers-light-320-rtl.png"});
});
