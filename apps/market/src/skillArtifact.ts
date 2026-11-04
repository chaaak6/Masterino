import { strFromU8, unzipSync } from 'fflate';
import matter from 'gray-matter';
import { z } from 'zod';

const requiredMetadata = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

/** The final submission boundary validates required metadata, regardless of caller. */
export function validateSkillContent(archive: Buffer) {
  const files = unzipSync(archive);
  const file = files['SKILL.md'];
  if (!file?.length) throw new Error('Skill ZIP must contain non-empty SKILL.md at its root');
  let data: unknown;
  try {
    data = matter(strFromU8(file), {
      engines: {
        javascript: () => {
          throw new Error('Executable frontmatter is not supported');
        },
      },
    }).data;
  } catch {
    throw new Error('SKILL.md frontmatter must be valid YAML');
  }
  const metadata = requiredMetadata.passthrough().safeParse(data);
  if (!metadata.success)
    throw new Error('SKILL.md frontmatter requires non-empty name and description');
  return {
    ...metadata.data,
    files: Object.keys(files)
      .filter((path) => !path.endsWith('/'))
      .map((path) => ({ path, type: 'file' })),
  };
}
