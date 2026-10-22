/** @type {import('@cucumber/cucumber').IConfiguration} */
export default {
  format: ['progress'],
  import: ['workspace-runtime/masterinoHome.steps.ts'],
  paths: ['workspace-runtime/masterino-home.feature'],
  publishQuiet: true,
  timeout: 30_000,
};
