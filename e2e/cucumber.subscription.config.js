export default {
  paths: ['src/features/subscription/*.feature'],
  requireModule: ['tsx/cjs'],
  require: ['src/support/world.ts', 'src/steps/subscription/*.ts'],
  format: ['progress', 'html:reports/subscription.html', 'json:reports/subscription.json'],
  parallel: 1,
};
