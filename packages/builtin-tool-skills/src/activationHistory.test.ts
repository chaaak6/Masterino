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
