import { describe, expect, it } from 'vitest';

import { SkillAuthoringManifest } from './manifest';
import { SkillAuthoringApiName } from './types';

describe('SkillAuthoringManifest', () => {
  it('requires human intervention for every write operation', () => {
    const writes = new Set([
      SkillAuthoringApiName.submitSkill,
      SkillAuthoringApiName.createProjectSkill,
      SkillAuthoringApiName.deleteProjectSkill,
      SkillAuthoringApiName.promoteProjectSkill,
      SkillAuthoringApiName.renameProjectSkill,
      SkillAuthoringApiName.updateProjectSkill,
    ]);

    for (const api of SkillAuthoringManifest.api) {
      if (writes.has(api.name as never)) expect(api.humanIntervention).toBe('required');
    }
  });

  it('keeps validate and pack read-only', () => {
    const readOnly = SkillAuthoringManifest.api.filter(({ name }) =>
      [SkillAuthoringApiName.validateProjectSkill, SkillAuthoringApiName.packProjectSkill].includes(
        name as never,
      ),
    );

    expect(readOnly).toHaveLength(2);
    expect(readOnly.every(({ humanIntervention }) => !humanIntervention)).toBe(true);
  });
});
