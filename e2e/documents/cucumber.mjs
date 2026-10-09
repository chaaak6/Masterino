export default {
  paths: ['e2e/documents/acceptance.feature'],
  import: ['e2e/documents/steps.ts'],
  format: ['progress', 'json:e2e/documents/.artifacts/cucumber.json'],
  parallel: 1,
};
