export default {
  paths: ['i18n/resources.feature'],
  import: ['i18n/resources.steps.mjs'],
  format: [
    'progress',
    'json:/tmp/masterino-i18n-acceptance/bdd-contracts.json',
    'html:/tmp/masterino-i18n-acceptance/bdd-contracts.html',
  ],
  parallel: 1,
};
