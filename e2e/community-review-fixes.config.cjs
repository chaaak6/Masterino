module.exports = {
  default: {
    paths: ['src/features/admin/community-review-fixes.feature'],
    require: ['src/steps/admin/community-review-fixes.steps.ts'],
    requireModule: ['tsx/cjs'],
    format: ['progress', 'json:reports/community-review-fixes.json'],
    parallel: 1,
  },
};
