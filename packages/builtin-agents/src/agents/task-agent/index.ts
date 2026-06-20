import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL, MASTERLION_AGENT_AVATAR } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

export const TASK_AGENT: BuiltinAgentDefinition = {
  avatar: MASTERLION_AGENT_AVATAR,
  persist: {
    model: DEFAULT_MODEL,
    provider: DEFAULT_PROVIDER,
  },
  runtime: (ctx) => ({
    plugins: [TaskIdentifier, ...(ctx.plugins || [])],
    systemRole: systemRoleTemplate,
  }),
  slug: BUILTIN_AGENT_SLUGS.taskAgent,
};
