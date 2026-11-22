import type { WorkspaceInitResult } from '@lobechat/types';

export const appendWorkspaceInstructions = (
  systemRole: string,
  instructions?: WorkspaceInitResult['instructions'],
): string => {
  if (!instructions?.length) return systemRole;

  const block = instructions
    .map(
      ({ content, source }) =>
        `<project_instructions source="${source}">\n${content}\n</project_instructions>`,
    )
    .join('\n\n');

  return systemRole ? `${systemRole}\n\n${block}` : block;
};
