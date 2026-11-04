import { z } from 'zod';

/** Give schema-invalid model output one correction attempt before failing the task. */
export const generateValidatedOutput = async <T>(
  generate: (feedback?: string) => Promise<unknown>,
  validate: (value: unknown) => T,
): Promise<T> => {
  const result = await generate();
  try {
    return validate(result);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;

    const issues = error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path,
      ...(issue.code === 'invalid_type' ? { expected: issue.expected } : {}),
      ...(issue.code === 'invalid_enum_value' ? { allowed: issue.options } : {}),
    }));
    const feedback = [
      'The previous response failed output schema validation.',
      'Return the complete result again using the same schema/tool and original evidence.',
      'Include required fields, use the allowed enum values, and use real JSON arrays, not strings.',
      'Do not invent facts or IDs to satisfy the schema.',
      `Validation issues: ${JSON.stringify(issues)}`,
    ].join('\n');

    return validate(await generate(feedback));
  }
};
