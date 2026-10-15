module.exports = {
  default: {
    paths: ['stream-recovery.feature'],
    require: ['stream-recovery/steps.ts'],
    requireModule: ['tsx/cjs'],
    format: ['progress', 'json:reports/stream-recovery.json'],
    parallel: 1,
    retry: 0,
  },
};
