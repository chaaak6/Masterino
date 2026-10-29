import type { BuiltinSkill } from '@lobechat/types';

import { AgentBrowserSkill } from './agent-browser';
import { ArtifactsSkill } from './artifacts';
import { LobeHubSkill } from './lobehub';
import { OfficeDocumentsSkill } from './office-documents';
import { SkillCreatorSkill } from './skill-creator';
import { TaskSkill } from './task';
import { UploadSkill } from './upload-skill';

export { AgentBrowserIdentifier } from './agent-browser';
export { ArtifactsIdentifier } from './artifacts';
export { LobeHubIdentifier } from './lobehub';
export { OfficeDocumentsIdentifier } from './office-documents';
export { SkillCreatorIdentifier } from './skill-creator';
export { TaskIdentifier } from './task';

export const builtinSkills: BuiltinSkill[] = [
  AgentBrowserSkill,
  ArtifactsSkill,
  LobeHubSkill,
  OfficeDocumentsSkill,
  SkillCreatorSkill,
  UploadSkill,
  TaskSkill,
  // FindSkillsSkill
];
