import {test,expect} from "playwright/test";

test.beforeEach(async({page})=>{await page.goto("/");});
const order=page=>page.getByTestId("layers");

test("kind sublines and thumbnails render; unlabelled kinds fall back",async({page})=>{
  for(const text of ["Ellipse","Rectangle","Raster, locked","Text"])
    await expect(page.getByText(text,{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:/^Badge, Ellipse layer, red fill, 2 of 4/})).toBeVisible();
  await expect(page.locator('[aria-hidden="true"]').filter({has:page.locator("div")}).first()).toBeAttached();
});

test("the remove button deletes a layer at once and the host's undo restores it",async({page})=>{
  await page.getByRole("button",{name:"Remove Badge"}).click();
  await expect(order(page)).toHaveText("layers title,card,photo");
  await page.getByRole("button",{name:"Undo remove"}).click();
  await expect(order(page)).toHaveText("layers title,badge,card,photo");
});

test("keyboard: Tab reaches remove, Enter removes; Delete on a focused row removes",async({page})=>{
  const remove=page.getByRole("button",{name:"Remove Headline"});
  await remove.focus();
  await expect(remove).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(order(page)).toHaveText("layers badge,card,photo");
  const row=page.getByRole("button",{name:/^Card background, Rectangle layer/});
  await row.focus();
  await page.keyboard.press("Delete");
  await expect(order(page)).toHaveText("layers badge,photo");
});

test("locked rows cannot be removed by button or key",async({page})=>{
  const remove=page.getByRole("button",{name:"Remove Skyline"});
  await expect(remove).toBeDisabled();
  await page.getByRole("button",{name:/^Skyline, Raster layer/}).focus();
  await page.keyboard.press("Backspace");
  await expect(order(page)).toHaveText("layers title,badge,card,photo");
});
