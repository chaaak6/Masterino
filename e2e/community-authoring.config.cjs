module.exports = { default: {
  paths: ['src/features/admin/community-authoring.feature'],
  require: ['src/steps/admin/community-authoring.steps.ts'],
  requireModule: ['tsx/cjs'],
  format: ['progress', 'json:reports/community-authoring.json'],
  parallel: 1,
} };
