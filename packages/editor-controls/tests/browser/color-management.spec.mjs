import {test,expect} from 'playwright/test';
const state=page=>page.getByTestId('consumer-state');
test('print and HDR channel edits retain profile identity and non-byte values',async({page})=>{
 await page.goto('/color-management');const cyan=page.getByRole('textbox',{name:'Cyan percent',exact:true});await cyan.fill('25.5');await cyan.press('Enter');await expect(state(page)).toContainText('"profileId":"press","channels":[25.5,20,30,40],"alpha":0.8');
 await page.getByRole('tab',{name:'wide',exact:true}).click();const red=page.getByRole('textbox',{name:'Red floating channel',exact:true});await red.fill('-0.125');await red.press('Enter');await expect(state(page)).toContainText('"profileId":"p3","channels":[-0.125,2,1.25]');
});
test('profile selection and measured gamut inspection reach the application',async({page})=>{
 await page.goto('/color-management');await page.getByRole('tab',{name:'profiles',exact:true}).click();await page.getByRole('combobox',{name:'Color profile',exact:true}).click();await page.getByRole('option',{name:'Coated press (CMYK)',exact:true}).click();await expect(state(page)).toContainText('"profile":"press"');await expect(page.getByText('25 of 100 samples outside press; maximum delta E 3.4',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Inspect out-of-gamut colors',exact:true}).click();await expect(state(page)).toContainText('"inspect":1');
});
test('theme bindings preserve the reference and explicit detach removes it',async({page})=>{
 await page.goto('/color-management');await page.getByRole('tab',{name:'references',exact:true}).click();await page.getByRole('combobox',{name:'Theme color reference',exact:true}).click();await page.getByRole('option',{name:'Accent — Theme',exact:true}).click();await expect(state(page)).toContainText('"reference":"accent"');await page.getByRole('button',{name:'Detach theme reference',exact:true}).click();await expect(state(page)).toContainText('"reference":null');await expect(page.getByText('Literal color; no theme binding',{exact:true})).toBeVisible();
});
test('named ink edits have an explicit save boundary and visible provider errors',async({page})=>{
 await page.goto('/color-management');await page.getByRole('tab',{name:'ink',exact:true}).click();await page.getByRole('textbox',{name:'Color name',exact:true}).fill('New ink');await expect(state(page)).toContainText('"saved":""');await page.getByRole('button',{name:'Save named color',exact:true}).click();await expect(state(page)).toContainText('"saved":"New ink"');
 await page.goto('/color-management?fail=1');await page.getByRole('tab',{name:'ink',exact:true}).click();await page.getByRole('button',{name:'Save named color',exact:true}).click();await expect(page.getByText('Ink definition rejected',{exact:true})).toBeVisible();await expect(state(page)).toContainText('"saved":""');
});
test('proof cannot enable until a profile is chosen and retains rendering intent',async({page})=>{
 await page.goto('/color-management');await page.getByRole('tab',{name:'proof',exact:true}).click();await expect(page.getByRole('switch',{name:'Enable soft proof',exact:true})).toBeDisabled();await page.getByRole('combobox',{name:'Proof output profile',exact:true}).click();await page.getByRole('option',{name:'Coated press',exact:true}).click();await page.getByRole('switch',{name:'Enable soft proof',exact:true}).click();await page.getByRole('switch',{name:'Simulate paper color',exact:true}).click();await expect(state(page)).toContainText('"enabled":true,"profileId":"press","intent":"relative-colorimetric","blackPointCompensation":true,"simulatePaper":true');
});
for(const dir of ['ltr','rtl'])test(`color management fits a narrow ${dir} host`,async({page})=>{
 await page.setViewportSize({width:320,height:1000});await page.goto(`/color-management?dir=${dir}&theme=dark`);for(const name of ['print','wide','profiles','references','ink','proof']){await page.getByRole('tab',{name,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);}
});
test('Lab channels and conversion policy stay explicit and profile-preserving',async({page})=>{
 await page.goto('/color-management');await page.getByRole('tab',{name:'lab',exact:true}).click();const a=page.getByRole('textbox',{name:'Lab a*',exact:true});await a.fill('-70');await a.press('Enter');await expect(state(page)).toContainText('"model":"lab","profileId":"icc:lab","channels":[50,-70,80]');
 await page.getByRole('combobox',{name:'Print conversion policy',exact:true}).click();await page.getByRole('option',{name:'Preserve color appearance',exact:true}).click();await expect(state(page)).toContainText('"policy":"preserve-appearance"');
});
test('gamut mapping never overwrites original channels and named ink retains overprint',async({page})=>{
 await page.goto('/color-management');await page.getByRole('tab',{name:'profiles',exact:true}).click();await expect(page.getByText('original: p3; channels -0.2, 2, 0.5; alpha 1',{exact:true})).toBeVisible();await expect(page.getByText('mapped: press; channels 0, 75, 25, 10; alpha 1',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'ink',exact:true}).click();await page.getByRole('switch',{name:'Overprint named color',exact:true}).click();await expect(state(page)).toContainText('"overprint":true');
 await page.getByRole('tab',{name:'proof',exact:true}).click();await page.getByRole('switch',{name:'Show proof gamut clipping',exact:true}).click();await expect(state(page)).toContainText('"showGamutClipping":true');
});
