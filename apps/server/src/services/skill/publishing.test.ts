// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import * as trustedClient from '@/libs/trusted-client';

import { SkillPublishingService, skillFingerprint } from './publishing';

afterEach(() => vi.restoreAllMocks());

describe('skill publication snapshots', () => {
  const skill = {
    manifest: { name: 'probe', description: 'A probe' },
    content: 'Read the reference.',
    resources: new Map([['references/a.md', Buffer.from('original')]]),
  };
  it('recognizes the same content despite manifest key and file iteration order', () => {
    expect(skillFingerprint(skill)).toBe(
      skillFingerprint({ ...skill, manifest: { description: 'A probe', name: 'probe' } }),
    );
  });
  it('detects edits and deleted supporting resources', () => {
    expect(skillFingerprint(skill)).not.toBe(skillFingerprint({ ...skill, content: 'Edited' }));
    expect(skillFingerprint(skill)).not.toBe(skillFingerprint({ ...skill, resources: new Map() }));
  });

  it('submits identical artifact bytes for semantically identical ZIPs and different bytes for an edit', async () => {
    vi.spyOn(UserModel, 'findById').mockResolvedValue({
      email: 'publication-test@example.com',
      id: 'publication-test',
    } as Awaited<ReturnType<typeof UserModel.findById>>);
    vi.spyOn(trustedClient, 'generateTrustedClientToken').mockReturnValue('test-token');
    const submissions: { version: FormDataEntryValue | null; archive: Buffer }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const body = options!.body as FormData;
      const file = body.get('file') as File;
      submissions.push({
        version: body.get('version'),
        archive: Buffer.from(await file.arrayBuffer()),
      });
      return Response.json({ workflowState: 'submitted', versionId: 1 });
    });
    const service = new SkillPublishingService({} as LobeChatDatabase, 'publication-test');
    const reference = strToU8('Reference content');
    const script = strToU8('print("SAFE_MARKER")');
    const first = Buffer.from(
      zipSync({
        'SKILL.md': strToU8('---\nname: probe\ndescription: A probe\n---\nRead the reference.\n'),
        'references/a.md': reference,
        'scripts/probe.py': script,
      }),
    );
    const reordered = Buffer.from(
      zipSync({
        'scripts/probe.py': script,
        'references/a.md': reference,
        'SKILL.md': strToU8(
          '---\ndescription: "A probe"\nname: probe\n---\n\nRead the reference.\n\n',
        ),
      }),
    );
    expect(first.equals(reordered)).toBe(false);
    await service.submitArchive(first);
    await service.submitArchive(reordered);
    expect(submissions[1].version).toBe(submissions[0].version);
    expect(submissions[1].archive).toEqual(submissions[0].archive);
    const files = unzipSync(submissions[1].archive);
    expect(files['references/a.md']).toEqual(reference);
    expect(files['scripts/probe.py']).toEqual(script);

    await service.submitArchive(
      Buffer.from(
        zipSync({
          ...files,
          'references/a.md': strToU8('Updated reference'),
        }),
      ),
    );
    expect(submissions[2].version).not.toBe(submissions[0].version);
    expect(submissions[2].archive).not.toEqual(submissions[0].archive);
  });
});
