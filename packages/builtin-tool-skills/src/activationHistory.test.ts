import { describe, expect, it } from 'vitest';

import { selectActivatedSkillsFromMessages } from './activationHistory';

describe('project activation history', () => {
  it('rejects legacy project activations without a scoped stable identity', () => {
    const activation = {
      plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
      pluginState: {
        name: 'demo',
        source: 'project',
        location: '/project/.agents/skills/demo/SKILL.md',
      },
      role: 'tool',
    };
    expect(selectActivatedSkillsFromMessages([activation])).toBeUndefined();
    expect(
      selectActivatedSkillsFromMessages([{ ...activation, error: { message: 'failed' } }]),
    ).toBeUndefined();
    expect(
      selectActivatedSkillsFromMessages([
        { ...activation, pluginState: { name: 'demo', source: 'user' } },
      ]),
    ).toBeUndefined();
  });
});

it('preserves an internal resource version without changing the stable ID', () => {
  expect(
    selectActivatedSkillsFromMessages([
      {
        role: 'tool',
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: { id: 'user:demo', name: 'demo', resourceVersion: 'zip-v1' },
      },
    ]),
  ).toEqual([{ id: 'user:demo', name: 'demo', description: undefined, resourceVersion: 'zip-v1' }]);
});
