import {test,expect} from 'playwright/test';
const state=async page=>JSON.parse(await page.getByTestId('workflow-state').textContent());
test('tap preview, favorite and explicit batch apply preserve photo identities',async({page})=>{
 await page.goto('/photo-workflow');await page.getByRole('radio',{name:'Preview Warm',exact:true}).click();expect((await state(page)).preview).toBe('warm');await page.getByRole('button',{name:'Favorite Warm',exact:true}).click();expect((await state(page)).favorites).toEqual(['warm']);await page.getByRole('button',{name:'Apply preset to 2 photos',exact:true}).click();await expect.poll(async()=>(await state(page)).applied).toEqual({id:'warm',ids:['a','b']});
});
test('preset import/export retains versioned settings and refuses duplicate identity',async({page})=>{
 await page.goto('/photo-workflow');await page.getByRole('tab',{name:'Manager',exact:true}).click();await page.getByRole('button',{name:'Import photo preset',exact:true}).click();await expect.poll(async()=>(await state(page)).presets.length).toBe(2);await page.getByRole('button',{name:'Export photo preset',exact:true}).click();await expect.poll(async()=>(await state(page)).exportedPreset.length).toBeGreaterThan(0);const exported=JSON.parse((await state(page)).exportedPreset);expect(exported.id).toBe('imported');expect(exported.version).toBe(1);expect(exported.settings.exposure.temperature).toBe(7200);await page.getByRole('button',{name:'Import photo preset',exact:true}).click();await expect(page.getByText('A preset with this identity already exists')).toBeVisible();expect((await state(page)).presets.length).toBe(2);
});
test('malformed import cannot reach the preset library',async({page})=>{
 await page.goto('/photo-workflow?invalid=1');await page.getByRole('tab',{name:'Manager',exact:true}).click();await page.getByRole('button',{name:'Import photo preset',exact:true}).click();await expect(page.getByText(/Photo preset requires version 1/)).toBeVisible();expect((await state(page)).presets.length).toBe(1);
});
test('photo version compare and original restore preserve snapshot data',async({page})=>{
 await page.goto('/photo-workflow');await page.getByRole('tab',{name:'Versions',exact:true}).click();await page.getByRole('button',{name:'Compare selected photo version',exact:true}).click();expect((await state(page)).compared).toBe('original');await page.getByRole('button',{name:'Restore original photo settings',exact:true}).click();await expect.poll(async()=>(await state(page)).currentVersion).toBe('original');await expect(page.getByRole('radio',{name:'Graded print version',exact:true})).toBeVisible();
});
test('batch export captures exact watermark and metadata privacy intent',async({page})=>{
 await page.goto('/photo-workflow');await page.getByRole('tab',{name:'Export',exact:true}).click();await page.getByRole('switch',{name:'Add text watermark',exact:true}).click();await expect(page.getByRole('button',{name:'Export 2 photos',exact:true})).toBeDisabled();await page.getByRole('textbox',{name:'Photo watermark text',exact:true}).fill('Copyright Harbor');await page.getByRole('button',{name:'Export 2 photos',exact:true}).click();await expect.poll(async()=>(await state(page)).exportRequest!==null).toBe(true);const request=(await state(page)).exportRequest;expect(request.ids).toEqual(['a','b']);expect(request.settings.watermark.text).toBe('Copyright Harbor');expect(request.settings.metadata).toBe('preserve-without-location');
});


test('cancelled import cannot mutate the library after its reader completes late',async({page})=>{
 await page.goto('/photo-workflow?deferred=1');await page.getByRole('tab',{name:'Manager',exact:true}).click();await page.getByRole('button',{name:'Import photo preset',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel preset transfer',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel preset transfer',exact:true}).click();await page.getByRole('button',{name:'Finish preset import',exact:true}).click();expect((await state(page)).presets.length).toBe(1);await expect(page.getByRole('button',{name:'Import photo preset',exact:true})).toBeEnabled();
});
