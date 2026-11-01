import { expect, skipWebkitStorage, test } from './fixtures.ts';
import { importFixtures, openBook, setLayout } from './helpers.ts';

skipWebkitStorage();

// Root cause of "Escape did not close the settings sheet": the sheet registered its Escape listener in
// useEffect, which runs after paint. A key pressed right after the sheet appeared (a slider fill in
// e2e, or any input while the main thread is busy decoding) arrived before the listener existed.
test('Escape closes the settings sheet even when pressed the instant it appears', async ({
  page,
}) => {
  await importFixtures(page, ['basic-10.cbz']);
  await openBook(page, 'basic-10');
  await setLayout(page, 'Single');
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Reader settings' }).click();
  const dlg = page.getByRole('dialog', { name: 'Reader settings' });
  await dlg.getByLabel('Brightness').fill('1.3'); // no wait between opening, input and Escape
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});
