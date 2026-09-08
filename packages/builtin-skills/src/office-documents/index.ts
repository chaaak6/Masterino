import type { BuiltinSkill } from '@lobechat/types';

import { toResourceMeta } from '../lobehub/helpers';
import excel from './references/excel.md';
import powerpoint from './references/powerpoint.md';
import word from './references/word.md';
import content from './SKILL.md';

export const OfficeDocumentsIdentifier = 'office-documents';

export const OfficeDocumentsSkill: BuiltinSkill = {
  avatar: '📄',
  content,
  description:
    'Read and inspect Office documents, analyze Excel data, and create or modify files with the capabilities available in the current environment.',
  identifier: OfficeDocumentsIdentifier,
  name: 'Office Documents',
  resources: toResourceMeta({
    'references/excel': excel,
    'references/powerpoint': powerpoint,
    'references/word': word,
  }),
  source: 'builtin',
};
