import {test,expect} from 'playwright/test';
const doc=async page=>JSON.parse(await page.getByTestId('consumer-state').textContent());
const tab=(page,name)=>page.getByRole('tab',{name,exact:true}).click();
test('curve keyboard/numeric edits, insertion and deletion commit real host points',async({page})=>{
 await page.goto('/color-adjustments');const graph=page.getByRole('slider',{name:'Curve point output',exact:true});await graph.focus();await graph.press('ArrowUp');await expect.poll(async()=>(await doc(page)).curve.points[1].y).toBe(.71);
 await page.getByRole('button',{name:'Add curve point',exact:true}).click();expect((await doc(page)).curve.points).toHaveLength(4);await page.getByRole('button',{name:'Remove curve point',exact:true}).click();expect((await doc(page)).curve.points).toHaveLength(3);
});
test('curve pointer previews commit once, Escape cancels, and scrolling remeasures the host',async({page})=>{
 await page.goto('/color-adjustments');const graph=page.getByRole('slider',{name:'Curve point output',exact:true});let b=await graph.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+22+.3*(b.height-44));await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.2,{steps:4});await expect.poll(async()=>(await doc(page)).preview!==null).toBe(true);await page.mouse.up();await expect.poll(async()=>(await doc(page)).commits).toBe(1);
 await page.evaluate(()=>window.scrollTo(0,80));await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(80);
 const before=await doc(page);b=await graph.boundingBox();const p=before.curve.points[1];await page.mouse.move(b.x+22+p.x*(b.width-44),b.y+22+(1-p.y)*(b.height-44));await page.mouse.down();await page.mouse.move(b.x+b.width*.7,b.y+b.height*.4,{steps:3});await graph.press('Escape');await page.mouse.up();expect((await doc(page)).commits).toBe(1);expect((await doc(page)).preview).toBeNull();
});
test('gradient insertion interpolates a real stop and its numeric position is editable',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'gradient');await expect(page.getByRole('button',{name:'Remove gradient stop',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Add gradient stop',exact:true}).click();let s=await doc(page);expect(s.paint.stops).toHaveLength(3);expect(s.paint.stops[1].color).toEqual([128,128,128,255]);const position=page.getByRole('textbox',{name:'Stop position percent',exact:true});await position.fill('25');await position.press('Enter');expect((await doc(page)).paint.stops[1].offset).toBe(.25);
});
test('mesh edits retain topology and explain rejected folded geometry',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'mesh');const x=page.getByRole('textbox',{name:'Mesh X',exact:true});await x.fill('.1');await x.press('Enter');expect((await doc(page)).mesh.points[0].x).toBe(.1);await x.fill('1');await x.press('Enter');await expect(page.getByText('Mesh movement would fold or collapse a cell',{exact:true})).toBeVisible();expect((await doc(page)).mesh.points[0].x).toBe(.1);
});
test('levels, grading and wrapping HSL edits reach controlled values',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'levels');const gamma=page.getByRole('textbox',{name:'Levels Gamma',exact:true});await gamma.fill('2');await gamma.press('Enter');expect((await doc(page)).levels.gamma).toBe(2);
 await tab(page,'grade');await expect(page.getByRole('slider',{name:'Brightness',exact:true})).toHaveCount(0);await page.getByRole('slider',{name:'Hue and saturation',exact:true}).first().press('ArrowUp');expect((await doc(page)).grade.shadows.saturation).toBe(.05);
 await tab(page,'secondary');await page.getByRole('switch',{name:'Show secondary mask',exact:true}).click();expect((await doc(page)).hsl.showMask).toBe(true);expect((await doc(page)).hsl.hueStart).toBe(340);
});
test('scopes render only supplied decoded measurements and preserve mode selection',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'scopes');await expect(page.getByText('Luminance: 20 samples',{exact:true})).toBeVisible();await page.getByRole('radio',{name:'Waveform',exact:true}).click();await expect(page.getByLabel('waveform, 2 decoded samples',{exact:true})).toBeVisible();await expect(page.getByText('Decoded frame 125000 microseconds',{exact:true})).toBeVisible();
});
test('standalone SV and hue preserve the other color components',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'field');await page.getByRole('slider',{name:'Saturation and brightness',exact:true}).press('ArrowRight');let s=await doc(page);expect(s.hsv).toEqual({h:120,s:.51,v:.5,alpha:.75});const hue=page.getByRole('textbox',{name:'Hue degrees',exact:true});await hue.fill('240');await hue.press('Enter');expect((await doc(page)).hsv).toEqual({h:240,s:.51,v:.5,alpha:.75});
});
test('eyedropper samples document coordinates and applies original profile channels',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'sample');await expect(page.getByRole('button',{name:'Apply sampled color',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Sample document color',exact:true}).click();await page.getByRole('button',{name:'Apply sampled color',exact:true}).click();const s=await doc(page);expect(s.applied.sample.channels).toEqual([-.2,2,.25]);expect(s.applied.sample.profileId).toBe('linear:p3');expect(s.applied.request.x).toBe(20);
 await page.goto('/color-adjustments?fail=1');await tab(page,'sample');await page.getByRole('button',{name:'Sample document color',exact:true}).click();await expect(page.getByText('Document sampler unavailable',{exact:true})).toBeVisible();
});
for(const dir of ['ltr','rtl'])test(`adjustments fit narrow ${dir} panes`,async({page})=>{
 await page.setViewportSize({width:320,height:1000});await page.goto(`/color-adjustments?dir=${dir}&theme=dark`);for(const name of ['curves','levels','gradient','mesh','grade','secondary','scopes','field','sample']){await tab(page,name);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);}
});
test('gradient midpoint, interpolation, type and angle are actual controlled edits',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'gradient');const midpoint=page.getByRole('textbox',{name:'Gradient midpoint percent',exact:true});await midpoint.fill('25');await midpoint.press('Enter');expect((await doc(page)).gradientOptions.midpoints).toEqual([.25]);
 await page.getByRole('combobox',{name:'Gradient interpolation',exact:true}).click();await page.getByRole('option',{name:'Linear-light RGB',exact:true}).click();expect((await doc(page)).gradientOptions.interpolation).toBe('linear-rgb');
 const angle=page.getByRole('textbox',{name:'Gradient angle degrees',exact:true});await angle.fill('90');await angle.press('Enter');expect((await doc(page)).paint.y1).toBe(100);
 await page.getByRole('combobox',{name:'Gradient type',exact:true}).click();await page.getByRole('option',{name:'Radial',exact:true}).click();expect((await doc(page)).paint.type).toBe('radial');
});
test('curve presets target the selected RGB/Luma channel and identity reset commits exact endpoints',async({page})=>{
 await page.goto('/color-adjustments');await page.getByRole('combobox',{name:'Curve channel',exact:true}).click();await page.getByRole('option',{name:'Luma',exact:true}).click();await page.getByRole('combobox',{name:'Curve preset',exact:true}).click();await page.getByRole('option',{name:'Contrast',exact:true}).click();let s=await doc(page);expect(s.lumaCurve.points[1].y).toBe(.8);expect(s.curve.points[1].y).toBe(.7);
 await page.getByRole('button',{name:'Reset curve to identity',exact:true}).click();expect((await doc(page)).lumaCurve.points.map(p=>[p.x,p.y])).toEqual([[0,0],[1,1]]);
});
test('lift gamma gain and RGB parade retain their control values and measured data',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'grade');await page.getByRole('radio',{name:'Lift / gamma / gain',exact:true}).click();const gamma=page.getByRole('textbox',{name:'Gamma level value',exact:true});await gamma.fill('1.5');await gamma.press('Enter');expect((await doc(page)).grade.liftGammaGain.gamma).toBe(1.5);
 await tab(page,'scopes');await expect(page.getByText('Clipped low 1, high 2',{exact:true})).toBeVisible();await page.getByRole('radio',{name:'RGB parade',exact:true}).click();for(const color of ['red','green','blue'])await expect(page.getByLabel(`${color} parade, 1 decoded samples`,{exact:true})).toBeVisible();
});
test('mesh default surface renders real interpolated multicolor pixels',async({page})=>{
 await page.goto('/color-adjustments');await tab(page,'mesh');const image=page.getByTestId('mesh-editor').locator('img');await expect(image).toHaveJSProperty('naturalWidth',48);
 const pixels=await image.evaluate(image=>{const c=document.createElement('canvas');c.width=c.height=48;const context=c.getContext('2d');context.drawImage(image,0,0);const at=(x,y)=>[...context.getImageData(x,y,1,1).data];return {top:at(0,0),bottom:at(0,47),center:at(24,24)};});expect(pixels.top).toEqual([255,0,0,255]);expect(pixels.bottom).toEqual([0,0,255,255]);expect(Math.min(...pixels.center.slice(0,3))).toBeGreaterThan(100);expect(Math.max(...pixels.center.slice(0,3))).toBeLessThan(160);
});
