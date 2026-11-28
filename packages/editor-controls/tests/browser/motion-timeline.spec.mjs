import {test,expect} from 'playwright/test';
const state=async page=>JSON.parse(await page.getByTestId('motion-timeline-state').textContent());
const time=(s,property,id)=>s.curves.find(c=>c.id===property).keys.find(k=>k.id===id).time;
async function drag(page,target,dx){const b=await target.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2,{steps:8});}
test('Shift selects across tracks and dragging commits one bounded group translation',async({page})=>{
 await page.goto('/motion-timeline');await page.keyboard.down('Shift');await page.getByTestId('motion-key-y-b').click();await page.keyboard.up('Shift');expect((await state(page)).selection.length).toBe(2);await drag(page,page.getByTestId('motion-key-x-b'),260);await expect.poll(async()=>(await state(page)).preview).toBe(true);expect((await state(page)).commits).toBe(0);await page.mouse.up();await expect.poll(async()=>(await state(page)).commits).toBe(1);const s=await state(page);expect(time(s,'x','b')).toBe(1.75);expect(time(s,'y','b')).toBe(1.25);expect(time(s,'x','c')).toBe(2);expect(s.preview).toBe(false);
});
test('Control toggles a selected key and the virtual key list retains the same group',async({page})=>{
 await page.goto('/motion-timeline');await page.keyboard.down('Control');await page.getByTestId('motion-key-x-b').click();await page.keyboard.up('Control');expect((await state(page)).selection).toEqual([]);await page.getByRole('radio',{name:'Key list',exact:true}).click();await page.getByRole('checkbox',{name:'Select Position X key b',exact:true}).click();await page.getByRole('checkbox',{name:'Select Position Y key b',exact:true}).click();expect((await state(page)).selection.length).toBe(2);await page.getByRole('radio',{name:'Property lanes',exact:true}).click();await page.getByTestId('motion-key-x-b').focus();await page.keyboard.press('ArrowRight');const s=await state(page);expect(time(s,'x','b')).toBe(1.25);expect(time(s,'y','b')).toBe(.75);expect(s.commits).toBe(1);
});
test('Escape and a composition switch cancel active group drags',async({page})=>{
 await page.goto('/motion-timeline');const target=page.getByTestId('motion-key-x-b');await target.focus();await drag(page,target,30);await page.keyboard.press('Escape');await page.mouse.up();expect((await state(page)).commits).toBe(0);await drag(page,target,30);await page.getByRole('button',{name:'Switch timeline composition',exact:true}).evaluate(button=>button.click());await page.mouse.up();const s=await state(page);expect(s.scope).toBe('composition-b');expect(time(s,'x','b')).toBe(1);expect(s.commits).toBe(0);
});
test('editing playhead text cannot trigger a timeline delete shortcut',async({page})=>{
 await page.goto('/motion-timeline');await page.getByRole('radio',{name:'Timing',exact:true}).click();const field=page.getByRole('textbox',{name:'Motion playhead seconds',exact:true});await field.fill('1.5');await field.press('Backspace');await field.fill('1.5');await field.press('Enter');const s=await state(page);expect(s.playhead).toBe(1.5);expect(s.curves[0].keys.length).toBe(4);expect(s.commits).toBe(0);
});
test('group deletion is one atomic edit and retains unselected properties and keys',async({page})=>{
 await page.goto('/motion-timeline');await page.getByRole('radio',{name:'Key list',exact:true}).click();await page.getByRole('checkbox',{name:'Select Position Y key b',exact:true}).click();await page.getByRole('button',{name:'Delete selected motion keys',exact:true}).click();const s=await state(page);expect(s.curves[0].keys.map(k=>k.id)).toEqual(['a','c','d']);expect(s.curves[1].keys.map(k=>k.id)).toEqual(['a','c']);expect(s.selection).toEqual([]);expect(s.commits).toBe(1);
});
