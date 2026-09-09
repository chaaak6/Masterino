import { expect, it } from 'vitest';

import { assertLegacySandboxSkillBoundary } from './skillExecutionBoundary';

it('preserves plain user-authored sandbox code without skill preparation', () => {
  expect(() =>
    assertLegacySandboxSkillBoundary('execScript', { command: 'print(1)', activatedSkills: [] }),
  ).not.toThrow();
  expect(() =>
    assertLegacySandboxSkillBoundary('runCommand', { command: 'echo hello' }),
  ).not.toThrow();
});
it.each([
  { activatedSkills: [{ id: 'user:demo', name: 'demo', resourceVersion: 'v1' }] },
  { skillZipUrls: { demo: 'https://example.com/a.zip' } },
  { zipUrl: 'https://example.com/a.zip' },
])('rejects skill package preparation without operation authority', (params) => {
  expect(() => assertLegacySandboxSkillBoundary('execScript', params)).toThrow(
    'SKILL_OPERATION_BINDING_REQUIRED',
  );
});
