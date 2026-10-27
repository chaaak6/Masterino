import { describe, expect, it } from 'vitest';

import { buildResourcesTreeText, resourcesTreePrompt } from './resourcesTree';

describe('skill resource previews', () => {
  it('bounds activation context without removing files from the full tree', () => {
    const resources = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [
        `ref-${String(i).padStart(3, '0')}.md`,
        { fileHash: `hash-${i}`, size: 10 },
      ]),
    );
    const prompt = resourcesTreePrompt('user:report', resources);
    expect(prompt).toContain('Showing 200 of 201 files');
    expect(prompt).toContain('ref-199.md');
    expect(prompt).not.toContain('ref-200.md');
    expect(buildResourcesTreeText(resources)).toContain('ref-200.md');
    expect(prompt).toContain('id="user:report"');
  });
});
