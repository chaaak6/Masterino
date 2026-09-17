import baseConfig from './cucumber.config.js';

export default {
  ...baseConfig,
  paths: ['src/features/file/browser-file-access.feature'],
  tags: '@live-test and @file-access',
};
