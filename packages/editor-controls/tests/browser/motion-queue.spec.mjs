import {test,expect} from 'playwright/test';
const state=async page=>JSON.parse(await page.getByTestId('motion-queue-state').textContent());
test('sequence enqueue preserves rational rate, alpha and output profile',async({page})=>{
 await page.goto('/motion-queue');await page.getByRole('button',{name:'Add composition to render queue',exact:true}).click();await expect.poll(async()=>(await state(page)).captured!==null).toBe(true);const s=await state(page);expect(s.captured.frameRate).toEqual({numerator:30000,denominator:1001});expect(s.captured.alpha).toBe('straight');expect(s.captured.profileId).toBe('display-p3');expect(s.captured.framePadding).toBe(6);await expect(page.getByText('12 of 60 frames reported',{exact:true})).toBeVisible();
});
test('invalid output names stay editable and cannot enqueue',async({page})=>{
 await page.goto('/motion-queue');const field=page.getByRole('textbox',{name:'Render output name',exact:true});await field.fill('');await expect(page.getByRole('button',{name:'Add composition to render queue',exact:true})).toBeDisabled();await field.fill('../escape');await expect(page.getByText('Enter an output file stem without a path',{exact:true})).toBeVisible();expect((await state(page)).requests).toEqual([]);await field.fill('Print');await expect(page.getByRole('button',{name:'Add composition to render queue',exact:true})).toBeEnabled();
});
test('queue reorder leaves the active job in place; cancelling reports an exact identity',async({page})=>{
 await page.goto('/motion-queue');await page.getByRole('radio',{name:'Queued renders',exact:true}).click();await page.getByRole('button',{name:'Move earlier second',exact:true}).click();await expect.poll(async()=>(await state(page)).jobs.map(j=>j.id)).toEqual(['second','active','first']);await page.getByRole('button',{name:'Cancel active',exact:true}).click();await expect.poll(async()=>(await state(page)).requests).toContain('cancel active');expect((await state(page)).jobs.find(job=>job.id==='active').status).toBe('cancelled');
});
test('cancelled enqueue cannot mark a late provider return as a queued render',async({page})=>{
 await page.goto('/motion-queue?deferred=1');await page.getByRole('button',{name:'Add composition to render queue',exact:true}).click();await page.getByRole('button',{name:'Cancel queue request',exact:true}).click();await page.getByRole('button',{name:'Finish queue provider',exact:true}).click();expect((await state(page)).captured).toBe(null);expect((await state(page)).requests).toEqual([]);
});
test('easing choices preserve overshoot while unsupported springs remain unavailable',async({page})=>{
 await page.goto('/motion-queue');await page.getByRole('tab',{name:'Easing',exact:true}).click();await expect(page.getByRole('radio',{name:'Damped spring',exact:true})).toBeDisabled();await page.getByRole('radio',{name:'Overshoot',exact:true}).click();const s=await state(page);expect(s.selectedEasing).toBe('overshoot');expect(s.easing.y1).toBe(1.56);await page.getByRole('radio',{name:'Ease in and out',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('radio',{name:'Ease in',exact:true})).toBeFocused();
});


test('a spring-capable evaluator receives the complete physical preset',async({page})=>{
 await page.goto('/motion-queue?spring=1');await page.getByRole('tab',{name:'Easing',exact:true}).click();await page.getByRole('radio',{name:'Damped spring',exact:true}).click();expect((await state(page)).easing).toEqual({kind:'spring',mass:1,stiffness:100,damping:10,velocity:0});
});
