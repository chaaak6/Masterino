module.exports = {
  default: {
    paths: ['src/features/admin/community-cli.feature'],
    require: ['src/steps/admin/community-cli.steps.ts'],
    requireModule: ['tsx/cjs'],
    format: ['progress', 'json:reports/community-cli.json'],
    parallel: 1,
  },
};
