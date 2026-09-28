import { readFileSync, readdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const variables = (value) =>
  [...String(value).matchAll(/{{\s*-?\s*([^},\s]+)(?:,[^}]*)?\s*}}/g)].map((m) => m[1]).sort();

/** Compare keys and interpolation contracts, not translation wording. */
export function checkPrimaryLocales() {
  const errors = [];
  let checked = 0;
  for (const [directory, english] of [
    ['locales', 'en-US'],
    ['apps/desktop/resources/locales', 'en'],
  ]) {
    for (const file of readdirSync(resolve(root, directory, english)).filter((f) =>
      f.endsWith('.json'),
    )) {
      const source = read(resolve(root, directory, english, file));
      for (const locale of ['zh-CN', 'vi-VN']) {
        let target;
        try {
          target = read(resolve(root, directory, locale, file));
        } catch {
          errors.push(`${directory}/${locale}/${file}: missing namespace`);
          continue;
        }
        for (const [key, value] of Object.entries(source)) {
          checked++;
          if (!(key in target)) errors.push(`${directory}/${locale}/${file}:${key}: missing key`);
          else if (JSON.stringify(variables(value)) !== JSON.stringify(variables(target[key])))
            errors.push(`${directory}/${locale}/${file}:${key}: interpolation mismatch`);
          else if (typeof value !== typeof target[key])
            errors.push(`${directory}/${locale}/${file}:${key}: value type mismatch`);
        }
      }
    }
  }
  // Catch a new source key even when nobody regenerated the English JSON.
  // models/providers are generated model-bank descriptions, not UI dictionaries.
  for (const [sourceDir, outputDir, english] of [
    ['packages/locales/src/default', 'locales', 'en-US'],
    ['apps/desktop/src/main/locales/default', 'apps/desktop/resources/locales', 'en'],
  ]) {
    for (const file of readdirSync(resolve(root, sourceDir)).filter(
      (f) =>
        f.endsWith('.ts') &&
        !f.endsWith('.test.ts') &&
        !['index.ts', 'models.ts', 'providers.ts'].includes(f),
    )) {
      const context = {};
      const code = stripTypeScriptTypes(readFileSync(resolve(root, sourceDir, file), 'utf8'));
      runInNewContext(code.replace('export default', 'globalThis.localeSource ='), context, {
        timeout: 1000,
      });
      for (const locale of [english, 'zh-CN', 'vi-VN']) {
        const target = read(resolve(root, outputDir, locale, file.replace(/\.ts$/, '.json')));
        for (const [key, value] of Object.entries(context.localeSource)) {
          checked++;
          if (!(key in target))
            errors.push(`${outputDir}/${locale}/${file}:${key}: missing source key`);
          else if (JSON.stringify(variables(value)) !== JSON.stringify(variables(target[key])))
            errors.push(`${outputDir}/${locale}/${file}:${key}: source interpolation mismatch`);
        }
      }
    }
  }
  return { checked, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { checked, errors } = checkPrimaryLocales();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Primary locale contracts passed: ${checked} key/placeholder checks.`);
}
