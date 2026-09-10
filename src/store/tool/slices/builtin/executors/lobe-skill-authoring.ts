import {
  SkillAuthoringApiName,
  SkillAuthoringIdentifier,
} from '@lobechat/builtin-tool-skill-authoring';
import type { IBuiltinToolExecutor } from '@lobechat/types';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { agentSkillService } from '@/services/skill';
import { useFileStore } from '@/store/file';

const apis = Object.values(SkillAuthoringApiName);

/** Authoring uses the same device boundary and confirmations as local file tools. */
export const skillAuthoringExecutor: IBuiltinToolExecutor = {
  identifier: SkillAuthoringIdentifier,
  getApiNames: () => apis,
  hasApi: (name) => apis.includes(name as (typeof apis)[number]),
  invoke: async (apiName, params, ctx) => {
    const execution = ctx.executionContext;
    if (ctx.signal?.aborted) return { success: false, stop: true };
    if (execution?.plan.kind !== 'device' || execution.plan.target !== 'local' || !execution.cwd) {
      return {
        success: false,
        content: 'WORKSPACE_REQUIRED: select a local workspace before creating a skill.',
      };
    }
    const result = await gatewayConnectionService.executeLocalToolCall({
      apiName: apiName === 'promoteProjectSkill' ? 'packProjectSkill' : apiName,
      args: params,
      executionContext: {
        accessRoots: execution.accessRoots,
        approvalMode: execution.approvalMode,
        cwd: execution.cwd,
        workspaceRootPath: execution.workspace?.rootPath ?? execution.cwd,
        workspaceKind: execution.workspace?.kind,
      },
      trace: {
        deviceId: execution.plan.deviceId,
        operationId: execution.operationId ?? ctx.operationId,
        topicId: ctx.topicId ?? undefined,
        toolCallId: ctx.toolCallId,
      },
    });
    if (result.success && (apiName === 'promoteProjectSkill' || apiName === 'packProjectSkill')) {
      const packed = (
        result.state as { result: { archiveBase64: string; size: number; validation: unknown } }
      ).result;
      if (apiName === 'promoteProjectSkill') {
        const bytes = Uint8Array.from(atob(packed.archiveBase64), (character) =>
          character.charCodeAt(0),
        );
        const uploaded = await useFileStore.getState().uploadWithProgress({
          file: new File([bytes], `${(params as { name: string }).name}.zip`, {
            type: 'application/zip',
          }),
          skipCheckFileType: true,
        });
        if (!uploaded) return { success: false, content: 'Skill archive upload failed.' };
        const promoted = await agentSkillService.importFromZip({ zipFileId: uploaded.id });
        return {
          success: !!promoted,
          content: promoted
            ? 'Project skill copied to the personal library.'
            : 'Skill import failed.',
          state: { promoted },
        };
      }
      return {
        success: true,
        content: `Packed project skill (${packed.size} bytes).`,
        state: { size: packed.size, validation: packed.validation },
      };
    }
    return { ...result, state: result.state, success: result.success };
  },
};
