import type { ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import type { ToolExecutionResult } from './types';

const log = debug('lobe-server:tool-execution:skill-activation');
type SkillIdentity = { identifier: string; key?: string };

/** Both Agent runtime and desktop RPC reject invalid identities before recording success. */
export const validateSkillActivationResult = <T extends ToolExecutionResult>(
  skills: readonly SkillIdentity[] | undefined,
  tool: Pick<ChatToolPayload, 'apiName' | 'identifier' | 'id'>,
  result: T,
  operationId: string,
): { result: T; skill?: SkillIdentity } => {
  if (!result.success || tool.identifier !== 'lobe-skills' || tool.apiName !== 'activateSkill')
    return { result };
  const key = result.state?.id;
  const skill =
    typeof key === 'string' && key.length > 0
      ? skills?.find((entry) => entry.key === key)
      : undefined;
  if (skill) return { result, skill: { key, identifier: skill.identifier } };

  const errorCode = 'SKILL_ACTIVATION_IDENTITY_MISMATCH';
  log(
    '[%s] Skill activation rejected: toolCallId=%s reason=%s',
    operationId,
    tool.id,
    typeof key === 'string' ? 'key-not-in-operation' : 'missing-key',
  );
  return {
    result: {
      ...result,
      content: `${errorCode}: the returned Skill key is not available in this operation.`,
      deferred: undefined,
      error: { type: errorCode, message: errorCode },
      state: { errorCode },
      success: false,
    },
  };
};
