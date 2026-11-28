import {test} from 'playwright/test';
// Captures wait for the color dialog's modal fade to settle.
for(const theme of ['light','dark'])for(const [size,width,height] of [['phone',390,844],['tablet',834,1194]])test(`workspace5 capture ${theme} ${size}`,async({page})=>{
 await page.setViewportSize({width,height});await page.goto('/workspace5?theme='+theme);await page.screenshot({path:`shots/workspace5-${theme}-${size}.png`,fullPage:true});
 await page.getByRole('button',{name:'Pick color',exact:true}).click();await page.getByRole('dialog').waitFor({state:'visible'});await page.waitForTimeout(350);await page.screenshot({path:`shots/workspace5-${theme}-${size}-color.png`});
});
test('workspace5 RTL capture',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/workspace5?dir=rtl');await page.screenshot({path:'shots/workspace5-rtl-phone.png',fullPage:true});});
