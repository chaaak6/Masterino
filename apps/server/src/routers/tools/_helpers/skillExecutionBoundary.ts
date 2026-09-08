/** The legacy sandbox endpoint has no authoritative operation Skill registry. */
export function assertLegacySandboxSkillBoundary(
  toolName: string,
  params: Record<string, unknown>,
) {
  if (
    params.skillZipUrls !== undefined ||
    params.zipUrl !== undefined ||
    (toolName === 'execScript' &&
      Array.isArray(params.activatedSkills) &&
      params.activatedSkills.length > 0)
  )
    throw new Error(
      'SKILL_OPERATION_BINDING_REQUIRED: execute skill resources through the operation-bound Skills runtime',
    );
}
