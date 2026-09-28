export default {
  paths: ['i18n/desktop.feature'],
  import: ['i18n/desktop.steps.mjs'],
  format: [
    'progress',
    'json:/tmp/masterino-i18n-acceptance/bdd-desktop.json',
    'html:/tmp/masterino-i18n-acceptance/bdd-desktop.html',
  ],
  parallel: 0,
};
