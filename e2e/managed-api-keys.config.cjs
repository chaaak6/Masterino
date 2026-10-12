module.exports = {
  default: {
    paths: ['src/features/admin/managed-api-keys.feature'],
    require: ['src/steps/admin/managed-api-keys.steps.ts'],
    requireModule: ['tsx/cjs'],
    format: ['progress', 'json:reports/managed-api-keys.json'],
    parallel: 1,
  },
};
