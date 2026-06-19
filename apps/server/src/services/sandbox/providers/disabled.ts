import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';

import type {
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderFileExportRequest,
  SandboxProviderFileExportResult,
} from '../types';

const DISABLED_SANDBOX_MESSAGE =
  'Cloud sandbox is not configured. Configure SANDBOX_PROVIDER=onlyboxes or use local file download instead.';

export class DisabledSandboxProvider implements SandboxProvider {
  readonly capabilities = {
    backgroundCommands: false,
    exportFile: false,
    files: false,
    languages: [],
    persistentSession: false,
    shell: false,
    skillScripts: false,
  } as const satisfies SandboxProviderCapabilities;

  readonly kind = 'disabled';

  async callTool(): Promise<SandboxCallToolResult> {
    return {
      error: { message: DISABLED_SANDBOX_MESSAGE },
      result: null,
      sessionExpiredAndRecreated: false,
      success: false,
    };
  }

  async exportFileToUploadUrl(
    _request: SandboxProviderFileExportRequest,
  ): Promise<SandboxProviderFileExportResult> {
    return {
      error: { message: DISABLED_SANDBOX_MESSAGE },
      success: false,
    };
  }
}

