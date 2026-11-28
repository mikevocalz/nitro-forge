import {test,expect} from 'playwright/test';
// Color dialog and presenter ink from NYC-Tron UI's workspace5 page.
test.beforeEach(async({page})=>{await page.setViewportSize({width:834,height:1194});await page.goto('/workspace5');});
test('color draft cancel and apply each close once',async({page})=>{
 await page.getByRole('button',{name:'Pick color',exact:true}).click();await expect.poll(()=>page.getByRole('slider',{name:'Saturation and brightness',exact:true}).evaluate(el=>Array.from(el.querySelectorAll('*')).some(child=>getComputedStyle(child).backgroundImage.includes('linear-gradient')))).toBe(true);await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByTestId('log')).toContainText('cancel color');await page.getByRole('button',{name:'Pick color',exact:true}).click();await page.getByRole('button',{name:'Apply color',exact:true}).click();await expect(page.getByTestId('log')).toContainText('commit color');
});
test('presenter stroke commits once; Escape cancels and eraser removes one gesture',async({page})=>{
 const overlay=page.getByTestId('ink-overlay');await overlay.scrollIntoViewIfNeeded();const b=await overlay.boundingBox();const x=b.x+80,y=b.y+70;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+90,y+30,{steps:8});await expect(page.getByTestId('stroke-count')).toHaveText('Strokes 0');await page.mouse.up();await expect(page.getByTestId('stroke-count')).toHaveText('Strokes 1');
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y+20,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();await expect(page.getByTestId('stroke-count')).toHaveText('Strokes 1');
 await page.getByRole('button',{name:'Eraser',exact:true}).click();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+70,y+25,{steps:5});await page.mouse.up();await expect(page.getByTestId('stroke-count')).toHaveText('Strokes 0');await expect(page.getByTestId('log')).toContainText('erase 1');
});
test('phone and RTL remain contained',async({page})=>{for(const dir of ['ltr','rtl']){await page.setViewportSize({width:390,height:844});await page.goto('/workspace5?dir='+dir);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}});
