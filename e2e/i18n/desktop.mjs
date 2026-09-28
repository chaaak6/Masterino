import { _electron as electron, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const testOrigin = 'https://mlai-test.bielcrystal.com';
export const copy = (locale, ns) =>
  JSON.parse(readFileSync(resolve(root, 'locales', locale, `${ns}.json`), 'utf8'));
const desktopRoot = resolve(root, 'apps/desktop');
const require = createRequire(resolve(desktopRoot, 'package.json'));

export async function launchDesktop(profile, { existingTestLogin = false } = {}) {
  const renderer = process.env.I18N_RENDERER_URL || 'http://127.0.0.1:5173';
  if (new URL(renderer).hostname !== '127.0.0.1')
    throw new Error('Use an isolated loopback frontend.');
  const id = profile || `local-${randomBytes(6).toString('hex')}`;
  if (existingTestLogin) {
    if (id !== 'test-server')
      throw new Error('Only the documented test-server login may be reused.');
    const settings = JSON.parse(
      readFileSync(
        resolve(
          homedir(),
          'Library/Application Support/masterino-desktop-test-server/lobehub-settings.json',
        ),
        'utf8',
      ),
    );
    if (settings.encryptedTokens?.issuerOrigin !== testOrigin)
      throw new Error('The saved login was not issued by the test cluster.');
  }
  if (!existingTestLogin && !/^local-[a-f0-9]{12}$/.test(id))
    throw new Error('Only isolated acceptance profiles are allowed.');
  const artifactDir = resolve(tmpdir(), 'masterino-i18n-acceptance', id);
  mkdirSync(artifactDir, { recursive: true });
  const configPath = resolve(artifactDir, 'desktop-config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      cloudServer: testOrigin,
      cloudServerAliases: [],
      marketBaseUrl: `${testOrigin}/market`,
    }),
  );
  const app = await electron.launch({
    executablePath: require('electron'),
    cwd: desktopRoot,
    args: [resolve(desktopRoot, 'dist/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MASTERINO_DEV_ENV: 'test',
      MASTERINO_DESKTOP_PROFILE: id,
      MASTERION_DESKTOP_CONFIG: configPath,
      OFFICIAL_CLOUD_SERVER: testOrigin,
      NEXT_PUBLIC_DESKTOP_CLOUD_SERVER: testOrigin,
      NEXT_PUBLIC_MARKET_BASE_URL: `${testOrigin}/market`,
      DEVICE_GATEWAY_URL: `${testOrigin}/device-gateway`,
      DISABLE_APP_UPDATE: '1',
      ELECTRON_RENDERER_URL: renderer,
    },
    timeout: 60000,
  });
  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    console.log('Desktop profile', id);
    page.on('requestfailed', (r) =>
      console.error('Request failed:', new URL(r.url()).pathname, r.failure()?.errorText),
    );
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('Console:', m.text().slice(0, 300));
    });
    page.on('pageerror', (error) => console.error('Renderer:', error.message));
    await page.waitForURL(/app:\/\/renderer\//, { waitUntil: 'commit' });
    if (existingTestLogin) {
      await expect(page.locator('#root')).not.toBeEmpty({ timeout: 120000 });
    } else {
      await expect(page.locator('svg.lucide-languages').first()).toBeVisible({ timeout: 120000 });
    }
    const backend = await page.evaluate(() => window.lobeEnv.cloudServer);
    expect(backend).toBe(testOrigin);
    return { app, page, id, artifactDir, backend };
  } catch (error) {
    await page
      ?.screenshot({ path: resolve(artifactDir, 'failure.png'), timeout: 5000 })
      .catch(() => {});
    console.error(
      'Launch failed at',
      page?.url(),
      await page
        ?.locator('body')
        .innerText({ timeout: 2000 })
        .catch(() => 'unavailable'),
    );
    await app.close();
    throw error;
  }
}

export async function chooseLanguage(page, locale) {
  const label = { 'en-US': 'English', 'zh-CN': '简体中文', 'vi-VN': 'Tiếng Việt' }[locale];
  const trigger = page.locator('svg.lucide-languages').first();
  await trigger.hover();
  const choice = page.getByRole('menuitemcheckbox').filter({ hasText: label });
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect
    .poll(() =>
      page.evaluate(() => window.electronAPI.invoke('system.getAppState')).then((s) => s.locale),
    )
    .toBe(locale);
}

export async function openOverlay(app) {
  const newPage = app.waitForEvent('window');
  await app.evaluate(
    async ({ BrowserWindow }, preload) => {
      const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: { preload, contextIsolation: true, sandbox: false },
      });
      await win.loadURL('app://renderer/overlay');
    },
    resolve(desktopRoot, 'dist/preload/index.js'),
  );
  return newPage;
}
