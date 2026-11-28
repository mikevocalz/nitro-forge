import {test,expect} from 'playwright/test';
const state=async page=>JSON.parse(await page.getByTestId('motion-settings-state').textContent());
const enter=async(page,label,text)=>{const input=page.getByRole('textbox',{name:label,exact:true});await input.fill(text);await input.press('Enter');};
test('3D entry preserves full rotations and untouched coordinates; reset is explicit',async({page})=>{
 await page.goto('/motion-settings');await enter(page,'3D rotation Z','720');await enter(page,'3D scale X','-1');const s=await state(page);expect(s.transform.rotation.z).toBe(720);expect(s.transform.rotation.x).toBe(0);expect(s.transform.scale.x).toBe(-1);expect(s.transform.scale.y).toBe(1);expect(s.commits).toBe(2);await page.getByRole('button',{name:'Reset 3D transform',exact:true}).click();expect((await state(page)).transform.rotation.z).toBe(0);
});
test('camera rejects a degenerate target visibly, then commits a valid depth',async({page})=>{
 await page.goto('/motion-settings');await page.getByRole('tab',{name:'Camera',exact:true}).click();await enter(page,'Camera target Z','10');await expect(page.getByText('Camera target must differ from its position',{exact:true})).toBeVisible();expect((await state(page)).commits).toBe(0);await enter(page,'Camera target Z','5');expect((await state(page)).camera.target.z).toBe(5);await page.getByRole('switch',{name:'Camera depth of field',exact:true}).click();await enter(page,'Camera focus distance','25');expect((await state(page)).camera.focusDistance).toBe(25);await expect(page.getByText('Light working profile: scene-linear-acescg',{exact:true})).toBeVisible();
});
test('matte sources exclude self and cycles while preserving selected alpha/luma intent',async({page})=>{
 await page.goto('/motion-settings');await page.getByRole('tab',{name:'Matte',exact:true}).click();await expect(page.getByRole('switch',{name:'Enable track matte',exact:true})).toBeDisabled();await page.getByRole('combobox',{name:'Track matte source',exact:true}).click();await expect(page.getByRole('option',{name:'Self layer',exact:true})).toBeDisabled();await expect(page.getByRole('option',{name:/Nested comp/})).toBeDisabled();await page.getByRole('option',{name:'Footage alpha',exact:true}).click();await page.getByRole('switch',{name:'Enable track matte',exact:true}).click();expect((await state(page)).matte.sourceId).toBe('footage');expect((await state(page)).matte.enabled).toBe(true);
});
test('particle seed and gravity are retained exactly without starting a simulator',async({page})=>{
 await page.goto('/motion-settings');await page.getByRole('tab',{name:'Particles',exact:true}).click();await enter(page,'Particle random seed','4294967295');await enter(page,'Particle gravity Y','-9.8');const s=await state(page);expect(s.particles.seed).toBe(4294967295);expect(s.particles.gravity.y).toBe(-9.8);expect(s.particles.enabled).toBe(false);expect(s.particles.textureId).toBe(null);
});
