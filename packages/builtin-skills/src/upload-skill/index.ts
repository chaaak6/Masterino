import type { BuiltinSkill } from '@lobechat/types';
import content from './SKILL.md';
export const UploadSkill: BuiltinSkill = {
  identifier: 'upload-skill',
  name: 'upload-skill',
  title: 'Submit Skill',
  description: 'Submit a personal or project skill for internal community review.',
  avatar: '📤',
  content,
  source: 'builtin',
};
