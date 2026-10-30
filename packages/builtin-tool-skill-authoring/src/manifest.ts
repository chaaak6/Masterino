import type { BuiltinToolManifest } from '@lobechat/types';

import { SkillAuthoringApiName, SkillAuthoringIdentifier } from './types';

const name = {
  description: 'Path-safe project skill name using lowercase letters, digits, and hyphens.',
  type: 'string',
} as const;

const mutating = { humanIntervention: 'required' as const };

export const SkillAuthoringManifest: BuiltinToolManifest = {
  api: [
    {
      ...mutating,
      name: SkillAuthoringApiName.submitSkill,
      description:
        'Submit a skill for internal community review, only when the user asks to share it. Pass skillId for a personal skill, or name for a skill in the current project. Submission is not publication.',
      parameters: {
        type: 'object',
        properties: {
          skillId: {
            type: 'string',
            description: 'Personal skill ID or identifier from the skill library.',
          },
          name,
        },
        additionalProperties: false,
      },
    },
    {
      ...mutating,
      description: 'Create a project skill from a complete SKILL.md document.',
      name: SkillAuthoringApiName.createProjectSkill,
      parameters: {
        properties: {
          content: { description: 'Complete SKILL.md including YAML frontmatter.', type: 'string' },
          name,
        },
        required: ['name', 'content'],
        type: 'object',
      },
    },
    {
      ...mutating,
      description: 'Replace one file in a project skill and validate the resulting bundle.',
      name: SkillAuthoringApiName.updateProjectSkill,
      parameters: {
        properties: {
          content: { type: 'string' },
          name,
          path: { description: 'Relative file path within the skill directory.', type: 'string' },
        },
        required: ['name', 'path', 'content'],
        type: 'object',
      },
    },
    {
      ...mutating,
      description: 'Rename a project skill directory and synchronize its frontmatter name.',
      name: SkillAuthoringApiName.renameProjectSkill,
      parameters: {
        properties: { name, newName: name },
        required: ['name', 'newName'],
        type: 'object',
      },
    },
    {
      ...mutating,
      description: 'Delete a project skill directory after user confirmation.',
      name: SkillAuthoringApiName.deleteProjectSkill,
      parameters: { properties: { name }, required: ['name'], type: 'object' },
    },
    {
      description: 'Validate project skill paths, files, sizes, and SKILL.md frontmatter.',
      name: SkillAuthoringApiName.validateProjectSkill,
      parameters: { properties: { name }, required: ['name'], type: 'object' },
    },
    {
      description: 'Pack a valid project skill into a deterministic ZIP archive.',
      name: SkillAuthoringApiName.packProjectSkill,
      parameters: { properties: { name }, required: ['name'], type: 'object' },
    },
    {
      ...mutating,
      description: 'Validate, pack, and promote a project skill into the personal skill library.',
      name: SkillAuthoringApiName.promoteProjectSkill,
      parameters: { properties: { name }, required: ['name'], type: 'object' },
    },
  ],
  identifier: SkillAuthoringIdentifier,
  meta: {
    avatar: '🧰',
    description: 'Create and maintain safe workspace project skills.',
    title: 'Skill Authoring',
  },
  systemRole:
    'Author project skills through structured operations. Draft complete instructions, keep every path relative to the selected skill, validate after changes, and promote only when the user asks for a personal copy.',
  type: 'builtin',
};
