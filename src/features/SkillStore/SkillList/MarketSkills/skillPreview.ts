import {
  readBoundedSkillBody,
  SKILL_EXPANDED_MAX_BYTES,
  SKILL_MAX_ENTRIES,
  SKILL_PACKAGE_MAX_BYTES,
} from '@lobechat/skill-package';
import type { SkillResourceTreeNode } from '@lobechat/types';
import { unzip } from 'fflate';

/**
 * Fetch zip from downloadUrl and extract text file contents
 */
export const fetchZipContents = async (
  url: string,
): Promise<{ contentMap: Record<string, string>; tree: SkillResourceTreeNode[] }> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error('Skill preview download failed');
  const buf = await readBoundedSkillBody(res.body, SKILL_PACKAGE_MAX_BYTES);

  return new Promise((resolve, reject) => {
    let count = 0;
    let expanded = 0;
    let previewBytes = 0;
    const paths: string[] = [];
    unzip(
      new Uint8Array(buf),
      {
        filter: (entry) => {
          if (
            ++count > SKILL_MAX_ENTRIES ||
            (expanded += entry.originalSize) > SKILL_EXPANDED_MAX_BYTES
          )
            throw new Error('Skill preview exceeds package limits');
          paths.push(entry.name);
          const previewable =
            /(?:SKILL\.md|\.(?:md|txt|json|yaml|yml|py|sh|bash|js|mjs|cjs|ts|tsx|jsx|ps1|bat|rb|r|toml|ini|cfg|csv))$/i.test(
              entry.name,
            ) && entry.originalSize <= 256 * 1024;
          if (!previewable || previewBytes + entry.originalSize > 8 * 1024 * 1024) return false;
          previewBytes += entry.originalSize;
          return true;
        },
      },
      (err, files) => {
        if (err) return reject(err);

        const contentMap: Record<string, string> = {};
        const tree: SkillResourceTreeNode[] = [];
        const decoder = new TextDecoder();

        const root = paths.includes('SKILL.md')
          ? ''
          : paths.find((path) => path.endsWith('/SKILL.md'))?.slice(0, -8) || '';
        for (const rawPath of paths) {
          if (rawPath.endsWith('/') || rawPath.includes('__MACOSX')) continue;

          // Strip the top-level directory prefix (e.g. "skill-name/")
          const path = root && rawPath.startsWith(root) ? rawPath.slice(root.length) : rawPath;
          if (!path) continue;

          const data = files[rawPath];
          const content = data ? decoder.decode(data) : undefined;
          if (content !== undefined) contentMap[path] = content;
          if (path === 'SKILL.md') continue;
          tree.push({
            content,
            name: path.split('/').pop() || path,
            path,
            type: 'file',
          });
        }

        tree.sort((a, b) => a.path.localeCompare(b.path));
        resolve({ contentMap, tree });
      },
    );
  });
};
