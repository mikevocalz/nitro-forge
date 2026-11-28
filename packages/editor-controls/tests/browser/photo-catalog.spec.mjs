import {test,expect} from 'playwright/test';
const state=async page=>JSON.parse(await page.getByTestId('catalog-state').textContent());
test('10,000-photo page virtualizes and retains off-page selection on toggle and open',async({page})=>{
 await page.goto('/photo-catalog');await page.getByRole('tab',{name:'Library',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Select Catalog photo 0',exact:true})).toBeVisible();
 expect(await page.getByRole('checkbox').count()).toBeLessThan(500);
 await page.getByRole('checkbox',{name:'Select Catalog photo 0',exact:true}).click();expect((await state(page)).selected).toEqual(['off-page','photo-0']);await page.getByRole('button',{name:'Open Catalog photo 0',exact:true}).click();expect((await state(page)).opened).toBe('photo-0');
});
test('capture dates reject impossible and reversed intervals without changing host filters',async({page})=>{
 await page.goto('/photo-catalog');const from=page.getByRole('textbox',{name:'Capture date from',exact:true});await from.fill('2023-02-29');await from.press('Enter');await expect(page.getByText('Catalog dates must be valid YYYY-MM-DD')).toBeVisible();expect((await state(page)).changes).toBe(0);
 await from.fill('2024-02-29');await from.press('Enter');expect((await state(page)).filters.dateFrom).toBe('2024-02-29');const to=page.getByRole('textbox',{name:'Capture date through',exact:true});await to.fill('2024-01-01');await to.press('Enter');await expect(page.getByText('Catalog date range is reversed')).toBeVisible();expect((await state(page)).filters.dateTo).toBe(null);
});
test('EXIF range enablement and clearing preserve explicit absence',async({page})=>{
 await page.goto('/photo-catalog');await page.getByRole('switch',{name:'Filter by ISO',exact:true}).click();const field=page.getByRole('textbox',{name:'ISO minimum',exact:true});await field.fill('400');await field.press('Enter');expect((await state(page)).filters.iso).toEqual([400,409600]);await page.getByRole('button',{name:'Clear photo filters',exact:true}).click();expect((await state(page)).filters.iso).toBe(null);await expect(field).toBeHidden();
});
test('canonical photo comparison uses actual decoded images and shared wipe keys',async({page})=>{
 await page.goto('/photo-catalog');await page.getByRole('tab',{name:'Compare',exact:true}).click();await page.getByRole('radio',{name:'Split',exact:true}).click();const divider=page.getByRole('slider');await divider.focus();await page.keyboard.press('ArrowRight');expect((await state(page)).split).toBe(.51);expect(await page.locator('img').count()).toBeGreaterThanOrEqual(2);await expect.poll(()=>page.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);await page.getByRole('radio',{name:'Reference',exact:true}).click();expect((await state(page)).mode).toBe('reference');
});


test('metadata preserves source values and commits only the separate annotation',async({page})=>{
 await page.goto('/photo-catalog');await page.getByRole('tab',{name:'Metadata',exact:true}).click();await expect(page.getByText('2026:11:06 09:10:00-05:00',{exact:true})).toBeVisible();await expect(page.getByText('Not recorded',{exact:true})).toBeVisible();const field=page.getByRole('textbox',{name:'Photo editing annotation',exact:true});await field.fill('Keep original RAW; crop for print.');await page.getByRole('button',{name:'Save photo annotation',exact:true}).click();const s=await state(page);expect(s.annotation).toBe('Keep original RAW; crop for print.');expect(s.annotationCommits).toBe(1);await expect(page.getByText('Harbor.dng',{exact:true})).toBeVisible();await expect(page.getByText('Source: Original imported file retained',{exact:true})).toBeVisible();
});
