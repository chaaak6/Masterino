import { test, expect } from '@playwright/test';
import { launchDesktop, chooseLanguage, openOverlay, copy, testOrigin } from './desktop.mjs';

test('primary languages survive IPC, a second window and a clean relaunch', async ({}, testInfo) => {
  test.setTimeout(240000);
  let run;
  try {
    run = await launchDesktop();
    const response = await run.page.request.get(`${testOrigin}/signin`);
    expect(response.ok()).toBeTruthy();
    for (const locale of ['en-US', 'zh-CN', 'vi-VN']) {
      await chooseLanguage(run.page, locale);
      await expect(
        run.page.getByText(copy(locale, 'onboarding')['telemetry.rows.create.desc'], {
          exact: true,
        }),
      ).toBeVisible();
      const menu = await run.app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()?.items.map((item) => item.label),
      );
      expect(menu.length).toBeGreaterThan(3);
      const overlay = await openOverlay(run.app);
      await expect(
        overlay.getByPlaceholder(copy(locale, 'electron')['overlay.idlePlaceholder']),
      ).toBeVisible();
      await expect(overlay.locator('html')).toHaveAttribute('lang', locale);
      await overlay.screenshot({ path: testInfo.outputPath(`overlay-${locale}.png`) });
      await overlay.close();
      await run.page.screenshot({ path: testInfo.outputPath(`onboarding-${locale}.png`) });
    }
    const id = run.id;
    await run.app.close();
    run = await launchDesktop(id);
    await expect(run.page.locator('html')).toHaveAttribute('lang', 'vi-VN');
    await expect(
      run.page.getByText(copy('vi-VN', 'onboarding')['telemetry.rows.create.desc'], {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await run?.app.close();
  }
});
