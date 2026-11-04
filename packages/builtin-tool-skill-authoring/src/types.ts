export const SkillAuthoringIdentifier = 'lobe-skill-authoring';

export const SkillAuthoringApiName = {
  submitSkill: 'submitSkill',
  createProjectSkill: 'createProjectSkill',
  deleteProjectSkill: 'deleteProjectSkill',
  packProjectSkill: 'packProjectSkill',
  promoteProjectSkill: 'promoteProjectSkill',
  renameProjectSkill: 'renameProjectSkill',
  updateProjectSkill: 'updateProjectSkill',
  validateProjectSkill: 'validateProjectSkill',
} as const;

export interface CreateProjectSkillArgs {
  /** Complete SKILL.md, including YAML frontmatter. */
  content: string;
  name: string;
}

export interface UpdateProjectSkillArgs {
  content: string;
  name: string;
  /** Relative file path within the skill directory. */
  path: string;
}

export interface RenameProjectSkillArgs {
  name: string;
  newName: string;
}

export interface ProjectSkillTargetArgs {
  name: string;
}
