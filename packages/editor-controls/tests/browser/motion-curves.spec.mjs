import {test,expect} from 'playwright/test';
const state=async page=>JSON.parse(await page.getByTestId('motion-curves-state').textContent());
const enter=async(page,label,value)=>{const field=page.getByRole('textbox',{name:label,exact:true});await field.fill(value);await field.press('Enter');};
async function drag(page,target,dx,dy){const b=await target.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:8});}
test('Bezier handle drag previews, commits once and Escape cancels a later gesture',async({page})=>{
 await page.goto('/motion-curves');const handle=page.getByTestId('motion-out');await handle.scrollIntoViewIfNeeded();await drag(page,handle,20,-10);await expect.poll(async()=>(await state(page)).preview).toBe(true);expect((await state(page)).commits).toBe(0);await page.mouse.up();await expect.poll(async()=>(await state(page)).commits).toBe(1);expect((await state(page)).value.keys[0].outHandle.value).toBeGreaterThan(30);await handle.focus();await drag(page,handle,10,5);await page.keyboard.press('Escape');await page.mouse.up();expect((await state(page)).commits).toBe(1);expect((await state(page)).preview).toBe(false);
});
test('numeric key edits retain other keys and property limits, add/subdivide and delete are exact',async({page})=>{
 await page.goto('/motion-curves');await enter(page,'Keyframe value','25');expect((await state(page)).value.keys[0].value).toBe(25);expect((await state(page)).value.keys[1].value).toBe(40);await page.getByRole('button',{name:'Add keyframe at playhead',exact:true}).click();expect((await state(page)).value.keys.length).toBe(4);expect((await state(page)).selected).toBe('added-1');await page.getByRole('button',{name:'Delete selected keyframe',exact:true}).click();expect((await state(page)).value.keys.length).toBe(3);
});
test('speed graph changes temporal influence and preserves undefined tangent slopes',async({page})=>{
 await page.goto('/motion-curves');await page.getByRole('tab',{name:'Speed',exact:true}).click();await enter(page,'Outgoing velocity per second','50');let s=await state(page);expect(s.value.keys[0].outHandle.value).toBe(10);await enter(page,'Outgoing influence seconds','0');await expect(page.getByText('Handle slope is undefined at zero time influence',{exact:true})).toBeVisible();s=await state(page);expect(s.value.keys[0].outHandle.time).toBe(0);
});
test('time remap supports reverse and freeze while keeping source time bounded',async({page})=>{
 await page.goto('/motion-curves');await page.getByRole('tab',{name:'Remap',exact:true}).click();await enter(page,'Source time seconds','2');let s=await state(page);expect(s.remap.keys[0].value).toBe(3);expect(s.remap.keys[1].value).toBe(2);expect(s.remap.keys[2].value).toBe(1);await enter(page,'Source time seconds','100');s=await state(page);expect(s.remap.keys[1].value).toBe(4);
});
test('a document switch cancels captured curve editing before a late release',async({page})=>{
 await page.goto('/motion-curves');const handle=page.getByTestId('motion-out');await handle.scrollIntoViewIfNeeded();await drag(page,handle,20,10);await expect.poll(async()=>(await state(page)).preview).toBe(true);await page.getByRole('button',{name:'Switch motion composition',exact:true}).evaluate(button=>button.click());await page.mouse.up();const s=await state(page);expect(s.scope).toBe('composition-b');expect(s.commits).toBe(0);expect(s.value.keys[0].outHandle).toEqual({time:.2,value:30});
});
