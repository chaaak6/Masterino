import { test, expect } from '@playwright/test';
import { launchDesktop, copy } from './desktop.mjs';

// Opt-in: uses the dedicated test account, never a daily/production profile.
test('test-cluster UI locales preserve account, model access and reply preference', async ({}, info) => {
  test.setTimeout(240000);
  let run;
  try {
    run = await launchDesktop('test-server', { existingTestLogin: true });
    const page = run.page;
    await expect(page.getByRole('button', { name: 'M MTEST10020 Test', exact: true })).toBeVisible({
      timeout: 90000,
    });
    await page.getByRole('button', { name: 'M MTEST10020 Test', exact: true }).click();
    await page.locator('a[href="/settings"]').click();
    await page.locator('a[href="/settings/appearance"]').click();
    await page.waitForURL('**/settings/appearance');
    await expect(page.getByRole('combobox').first()).toContainText(/English|简体中文|Tiếng Việt/);
    const replyPlaceholder = await page
      .getByRole('combobox')
      .nth(1)
      .getAttribute('data-placeholder');
    // This profile has no explicit reply-language preference; UI must leave it unset.
    expect(replyPlaceholder).not.toBeNull();
    for (const locale of ['zh-CN', 'en-US', 'vi-VN']) {
      await page.locator('a[href="/settings/appearance"]').click();
      await page.waitForURL('**/settings/appearance');
      await expect(page.getByRole('combobox').first()).toContainText(/English|简体中文|Tiếng Việt/);
      await page.getByRole('combobox').first().click();
      await page
        .getByRole('option', {
          name: { 'zh-CN': '简体中文', 'en-US': 'English', 'vi-VN': 'Tiếng Việt' }[locale],
          exact: true,
        })
        .click();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('combobox').nth(1)).toHaveAttribute(
        'data-placeholder',
        replyPlaceholder,
      );
      await page.locator('a[href="/settings/provider/all"]').click();
      await expect(
        page.getByText(copy(locale, 'aihub').bindingTitle, { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(copy(locale, 'aihub').bound, { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: copy(locale, 'aihub').refresh, exact: true }),
      ).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`provider-${locale}.png`) });
      await page.locator('a[href="/settings/stats"]').click();
      await expect(page.getByText(copy(locale, 'aihub').usage, { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`stats-${locale}.png`) });
    }
    // Navigate through the real home link and send a bounded, tool-free test prompt.
    await page.locator('a[href="/"]').first().click();
    await expect(page.locator('[contenteditable="true"]')).toBeVisible();
    await expect(
      page.getByText(copy('vi-VN', 'home')['starter.aihubDefault'], { exact: true }),
    ).toBeVisible();
    const marker = `I18N-ACCEPTANCE-${Date.now()}`;
    await page
      .locator('[contenteditable="true"]')
      .fill(`Do not use tools. Reply with exactly ${marker}.`);
    await page.locator('[contenteditable="true"]').press('Enter');
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 90000 });
    await page.reload();
    await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 60000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi-VN');
    await page.screenshot({ path: info.outputPath('chat-persistence-vi-VN.png') });
  } catch (error) {
    await run?.page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
    throw error;
  } finally {
    await run?.app.close();
  }
});
