import {test,expect} from 'playwright/test';
const state=async page=>JSON.parse(await page.getByTestId('photo-state').textContent());
const enter=async(page,label,text)=>{const field=page.getByRole('textbox',{name:label,exact:true});await field.fill(text);await field.press('Enter');};
test('photo ratings preserve independent color label and exclusive pick/reject',async({page})=>{
 await page.goto('/photo-develop');await page.getByRole('radio',{name:'4 stars',exact:true}).click();await page.getByRole('radio',{name:'Pick',exact:true}).click();await page.getByRole('radio',{name:'Reject',exact:true}).click();
 const s=await state(page);expect(s.rating).toEqual({stars:4,label:'none',flag:'reject'});expect(s.commits).toBe(3);await expect(page.getByRole('radio',{name:'Pick',exact:true})).not.toBeChecked();
});
test('develop commits precise exposure and one band while retaining original settings',async({page})=>{
 await page.goto('/photo-develop');await enter(page,'Exposure EV','1.25');await enter(page,'red hue','-12');await enter(page,'blue luminance','23');
 const s=await state(page);expect(s.value.exposure.exposure).toBe(1.25);expect(s.value.mixer.red.hue).toBe(-12);expect(s.value.mixer.blue.luminance).toBe(23);expect(s.value.mixer.green).toEqual({hue:0,saturation:0,luminance:0});expect(s.commits).toBe(3);
 await page.getByRole('button',{name:'Revert develop edits',exact:true}).click();expect((await state(page)).value.exposure.exposure).toBe(0);expect((await state(page)).value.mixer.red.hue).toBe(0);
});
test('copy/paste restores exact settings as a single host revision',async({page})=>{
 await page.goto('/photo-develop');await enter(page,'Exposure EV','1.25');await page.getByRole('button',{name:'Copy develop settings',exact:true}).click();await expect(page.getByRole('button',{name:'Copy develop settings',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Reset develop defaults',exact:true}).click();await page.getByRole('button',{name:'Paste develop settings',exact:true}).click();
 await expect.poll(async()=>(await state(page)).value.exposure.exposure).toBe(1.25);expect((await state(page)).commits).toBe(3);
});
test('invalid settings paste reports an error and retains the photo',async({page})=>{
 await page.goto('/photo-develop?invalid=1');await page.getByRole('button',{name:'Paste develop settings',exact:true}).click();await expect(page.getByText(/JSON|Unexpected|property name/).first()).toBeVisible();expect((await state(page)).commits).toBe(0);
});
test('changing photos cancels pending paste and discards late completion',async({page})=>{
 await page.goto('/photo-develop?deferred=1');await page.getByRole('button',{name:'Paste develop settings',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel settings transfer',exact:true})).toBeVisible();await page.getByRole('button',{name:'Switch photo',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel settings transfer',exact:true})).toBeHidden();await page.getByRole('button',{name:'Resolve pending paste',exact:true}).click();const s=await state(page);expect(s.photoId).toBe('portrait');expect(s.value.exposure.exposure).toBe(0);expect(s.commits).toBe(0);
});
test('lens values stay disabled until enabled and profile identity is retained',async({page})=>{
 await page.goto('/photo-develop');await expect(page.getByRole('textbox',{name:'Lens distortion',exact:true})).toBeDisabled();await page.getByRole('switch',{name:'Enable lens corrections',exact:true}).click();await enter(page,'Lens distortion','-17');await page.getByRole('switch',{name:'Remove chromatic aberration',exact:true}).click();const s=await state(page);expect(s.value.lens).toEqual({enabled:true,profileId:null,distortion:-17,chromaticAberration:true});
});


test('switching photos discards a numeric draft before its old field can blur',async({page})=>{
 await page.goto('/photo-develop');const field=page.getByRole('textbox',{name:'Exposure EV',exact:true});await field.fill('4.5');await page.getByRole('button',{name:'Switch photo',exact:true}).evaluate(button=>button.click());await page.getByRole('textbox',{name:'Exposure EV',exact:true}).blur();const s=await state(page);expect(s.photoId).toBe('portrait');expect(s.value.exposure.exposure).toBe(0);expect(s.commits).toBe(0);
});
