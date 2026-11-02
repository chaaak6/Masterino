import { TRPCError } from '@trpc/server';

const forbiddenSkillContent = [
  /\b(?:curl|wget)\b[^\n]*(?:\||>)\s*(?:ba)?sh\b/i,
  /\b(?:bitsadmin|cmd\.exe|invoke-webrequest|powershell|start-bitstransfer)\b/i,
  /\b(?:npm|pnpm|yarn|pip|brew|apt(?:-get)?)\s+install\b/i,
  /(?:^|\n)\s*(?:sudo\s+)?(?:ba|z)?sh\s+(?:--?[a-z]+\b|[<>'"]|(?:\.{0,2}\/|[\w.-]+\/)\S+|\S+\.sh\b)/i,
  /\b(?:chmod\s+\+x|rm\s+-rf)\b/i,
  /(?:\bdownload\b|下载).{0,120}https?:\/\//i,
  /(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*['"][^'"]{8,}/i,
  /\b(?:AKIA[0-9A-Z]{16}|gh[oprsu]_\w{20,})\b/,
];

export const assertSafeSkillContent = (content: string) => {
  if (forbiddenSkillContent.some((pattern) => pattern.test(content))) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Skill contains an unapproved installer, shell command, or embedded secret',
    });
  }
};

export const assertSafeSkillPackageContent = (skill: {
  content: string;
  resources: Map<string, Buffer>;
}) => {
  assertSafeSkillContent(skill.content);
  for (const [path, bytes] of skill.resources) {
    if (bytes.includes(0)) {
      if (
        path.startsWith('scripts/') ||
        /\.(?:[cm]?[jt]sx?|py|sh|bash|zsh|ps1|md|txt|json|ya?ml|toml|xml|html?|css|csv)$/i.test(
          path,
        )
      )
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Skill text resources must use UTF-8 without NUL bytes',
        });
      continue;
    }
    assertSafeSkillContent(bytes.toString('utf8'));
  }
};
