import {test,expect} from 'playwright/test';
const open=async(page,query='')=>{
  await page.setViewportSize({width:834,height:1194});
  await page.goto('/canvas-guides?'+query);
  await page.getByRole('button',{name:'Horizontal ruler',exact:true}).waitFor();
};

test('ruler keyboard adds one guide; Delete removes it',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Horizontal ruler',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('log')).toHaveText(/^log addGuide horizontal /);
  const added=(await page.getByTestId('log').textContent()).match(/horizontal ([-\d.]+)/)[1];
  const guide=page.getByLabel(`Horizontal guide at ${added} px`,{exact:true});
  await guide.focus();await page.keyboard.press('Delete');
  await expect(page.getByTestId('log')).toHaveText(/removeGuide g3$/);
});

test('ruler drag previews, Escape cancels, release creates one guide',async({page})=>{
  await open(page);
  const box=await page.getByRole('button',{name:'Horizontal ruler',exact:true}).boundingBox();
  const x=box.x+box.width/2,y=box.y+8;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+120,{steps:6});
  await expect(page.getByTestId('log')).toHaveText('log ');
  await expect(page.getByTestId('preview')).not.toHaveText('preview ');
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.getByTestId('log')).toHaveText('log ');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+120,{steps:6});await page.mouse.up();
  await expect(page.getByTestId('log')).toHaveText(/^log addGuide horizontal /);
});

test('pivot key changes its origin without moving the artwork',async({page})=>{
  await open(page,'select=L2');
  const before=await page.getByTestId('doc').textContent();
  await page.getByLabel('Pivot',{exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('log')).toHaveText(/^log setTransformOrigin /);
  await expect(page.getByTestId('doc')).toHaveText(before);
});

test('align emits once; locked selections report why without editing',async({page})=>{
  await open(page,'select=L1,L2,L3');
  await page.getByRole('button',{name:'Align left edges',exact:true}).click();
  await expect(page.getByTestId('log')).toHaveText(/^log alignLayers /);
  await open(page,'select=L4');
  await page.getByRole('button',{name:'Bring to front, unavailable',exact:true}).click();
  await expect(page.getByTestId('log')).toHaveText('log ');
  await expect(page.getByText(/Unlock Footer/).first()).toBeVisible();
});

for(const action of ['Replace ruler document','Disable ruler'])test(action+' cancels the held guide without committing',async({page})=>{await open(page);const box=await page.getByRole('button',{name:'Horizontal ruler',exact:true}).boundingBox(),x=box.x+box.width/2,y=box.y+8;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+100,{steps:5});await expect(page.getByTestId('preview')).not.toHaveText('preview ');await page.getByRole('button',{name:action,exact:true}).evaluate(el=>el.click());await page.mouse.move(x,y+150);await page.mouse.up();await expect(page.getByTestId('log')).toHaveText('log ');await expect(page.getByTestId('preview')).toHaveText('preview ');});
test('guide hit bands span the correct canvas dimension',async({page})=>{await open(page);const canvas=await page.getByTestId('canvas').boundingBox(),horizontal=await page.getByLabel('Horizontal guide at 200 px',{exact:true}).boundingBox(),vertical=await page.getByLabel('Vertical guide at 300 px',{exact:true}).boundingBox();expect(horizontal.width).toBeCloseTo(canvas.width);expect(vertical.height).toBeCloseTo(canvas.height);});

for(const title of ['Replace ruler document','Disable ruler'])test('grid numeric draft is abandoned after '+title,async({page})=>{await open(page);const input=page.getByLabel('Spacing value',{exact:true});await input.fill('72');await page.getByRole('button',{name:title,exact:true}).evaluate(el=>el.click());await page.keyboard.press('Enter');await expect(page.getByTestId('log')).toHaveText('log ');await expect(page.getByLabel('Spacing value',{exact:true})).toHaveValue('40');});

for(const title of ['Replace ruler document','Disable ruler'])test('pivot release cannot write after '+title,async({page})=>{await open(page);const pivot=page.getByLabel('Pivot',{exact:true}),box=await pivot.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y+20,{steps:4});await page.getByRole('button',{name:title,exact:true}).evaluate(el=>el.click());await page.mouse.up();await expect(page.getByTestId('log')).toHaveText('log ');});
