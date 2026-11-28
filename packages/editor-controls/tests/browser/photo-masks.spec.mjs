import {test,expect} from 'playwright/test';
const state=async page=>JSON.parse(await page.getByTestId('mask-state').textContent());
async function drag(page,surface){const b=await surface.boundingBox();await page.mouse.move(b.x+b.width*.2,b.y+b.height*.4);await page.mouse.down();await page.mouse.move(b.x+b.width*.7,b.y+b.height*.6,{steps:8});}
test('brush path previews and commits once with normalized image samples',async({page})=>{
 await page.goto('/photo-masks');const surface=page.getByLabel('Mask brush drawing surface',{exact:true});await surface.scrollIntoViewIfNeeded();await drag(page,surface);await expect.poll(async()=>(await state(page)).previewPoints).toBeGreaterThan(1);expect((await state(page)).commits).toBe(0);await page.mouse.up();await expect.poll(async()=>(await state(page)).commits).toBe(1);const s=await state(page);expect(s.strokes[0].photoId).toBe('a');expect(s.strokes[0].settings.operation).toBe('add');expect(s.strokes[0].points.length).toBeGreaterThan(1);expect(s.strokes[0].points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)).toBe(true);expect(s.previewPoints).toBe(0);
});
test('Escape cancels an active brush without a late release commit',async({page})=>{
 await page.goto('/photo-masks');const surface=page.getByLabel('Mask brush drawing surface',{exact:true});await surface.scrollIntoViewIfNeeded();await surface.focus();await drag(page,surface);await page.keyboard.press('Escape');await page.mouse.up();expect((await state(page)).commits).toBe(0);expect((await state(page)).previewPoints).toBe(0);
});
test('numeric mask and retouch stamps use one shared bounded input contract',async({page})=>{
 await page.goto('/photo-masks');await page.getByRole('button',{name:'Stamp mask brush',exact:true}).click();await expect.poll(async()=>(await state(page)).commits).toBe(1);expect((await state(page)).strokes[0].points).toEqual([{x:.5,y:.5,pressure:null}]);await page.getByRole('tab',{name:'Retouch',exact:true}).click();await page.getByRole('button',{name:'Stamp retouch brush',exact:true}).click();await expect.poll(async()=>(await state(page)).commits).toBe(2);expect((await state(page)).strokes[1].settings.method).toBe('heal');
});
test('gradient mask uses geometry-only handles and commits source-pixel keyboard nudges',async({page})=>{
 await page.goto('/photo-masks');await page.getByRole('tab',{name:'Gradient',exact:true}).click();await expect(page.getByTestId('gradient-stop-0')).toHaveCount(0);const end=page.getByTestId('gradient-end');await end.focus();await page.keyboard.press('ArrowRight');expect((await state(page)).gradient.geometry.x1).toBe(321);expect((await state(page)).commits).toBe(1);await page.getByRole('switch',{name:'Invert gradient mask',exact:true}).click();expect((await state(page)).gradient.invert).toBe(true);
});
test('range sampling retains original profile floats and declared combine policy',async({page})=>{
 await page.goto('/photo-masks');await page.getByRole('tab',{name:'Range',exact:true}).click();await page.getByRole('button',{name:'Sample photo range',exact:true}).click();await expect.poll(async()=>(await state(page)).commits).toBe(1);const s=await state(page);expect(s.range.color.profileId).toBe('linear-display-p3');expect(s.range.color.channels).toEqual([-.25,1.5,.2]);expect(s.range.combine).toBe('replace');
});
test('late document range samples cannot change another photo',async({page})=>{
 await page.goto('/photo-masks?deferred=1');await page.getByRole('tab',{name:'Range',exact:true}).click();await page.getByRole('button',{name:'Sample photo range',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel range sample',exact:true})).toBeVisible();await page.getByRole('button',{name:'Change mask photo',exact:true}).click();await page.getByRole('button',{name:'Finish range read',exact:true}).click();expect((await state(page)).photoId).toBe('b');expect((await state(page)).range.color).toBe(null);expect((await state(page)).commits).toBe(0);
});

test('gradient coverage pixels update during geometry preview and release commits once',async({page})=>{
 await page.goto('/photo-masks');await page.getByRole('tab',{name:'Gradient',exact:true}).click();
 const alpha=()=>page.locator('img').first().evaluate(async image=>{await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data[3];});
 const before=await alpha();const box=await page.getByTestId('gradient-end').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2,{steps:6});await expect.poll(async()=>(await state(page)).gradientPreview).toBe(true);expect(await alpha()).toBeLessThan(before);expect((await state(page)).commits).toBe(0);await page.mouse.up();expect((await state(page)).commits).toBe(1);expect((await state(page)).gradient.geometry.x1).toBe(370);
});
test('changing photos abandons a captured gradient drag before its late release',async({page})=>{
 await page.goto('/photo-masks');await page.getByRole('tab',{name:'Gradient',exact:true}).click();const box=await page.getByTestId('gradient-end').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2,{steps:4});await expect.poll(async()=>(await state(page)).gradientPreview).toBe(true);
 // External host document switch while pointer capture is still active.
 await page.getByRole('button',{name:'Change mask photo',exact:true}).evaluate(button=>button.click());await page.mouse.up();expect((await state(page)).photoId).toBe('b');expect((await state(page)).commits).toBe(0);expect((await state(page)).gradient.geometry.x1).toBe(320);expect((await state(page)).gradientPreview).toBe(false);
});
