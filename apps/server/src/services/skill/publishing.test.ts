// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { UserModel } from '@/database/models/user';
import * as trustedClient from '@/libs/trusted-client';

import { skillFingerprint, SkillPublishingService } from './publishing';

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
      return Response.json({ workflowState: 'submitted', resourceId: 1, versionId: 1 });
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

describe('skill submission responses and input errors', () => {
  const archive = Buffer.from(
    zipSync({
      'SKILL.md': strToU8('---\nname: probe\ndescription: A probe\n---\nInstructions'),
    }),
  );
  const service = () => new SkillPublishingService({} as LobeChatDatabase, 'publication-test');

  beforeEach(() => {
    vi.spyOn(UserModel, 'findById').mockResolvedValue({
      email: 'publication-test@example.com',
      id: 'publication-test',
    } as Awaited<ReturnType<typeof UserModel.findById>>);
    vi.spyOn(trustedClient, 'generateTrustedClientToken').mockReturnValue('test-token');
  });

  it.each([
    { status: 503, body: '<html>Unavailable</html>', code: 'BAD_GATEWAY' },
    { status: 409, body: 'Conflict', code: 'CONFLICT' },
    { status: 409, body: 'null', code: 'CONFLICT' },
    { status: 400, body: 'Invalid archive', code: 'BAD_REQUEST' },
  ])(
    'preserves HTTP $status semantics for a non-object error response',
    async ({ status, body, code }) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status }));
      await expect(service().submitArchive(archive)).rejects.toMatchObject({
        code,
        message: `Skill submission failed (HTTP ${status})`,
      });
    },
  );

  it('preserves a structured conflict message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'Version exists' }, { status: 409 }),
    );
    await expect(service().submitArchive(archive)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Version exists',
    });
  });

  it.each([
    'not-json',
    'null',
    '[]',
    '{}',
    JSON.stringify({ workflowState: 'submitted', versionId: 1 }),
    JSON.stringify({ workflowState: 'unknown', versionId: 1, resourceId: 1 }),
    JSON.stringify({ workflowState: 'draft', versionId: 1, resourceId: 1 }),
  ])('does not report success for an invalid successful response: %s', async (body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    await expect(service().submitArchive(archive)).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });

  it('returns the actual status and IDs for an idempotently reused version', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ workflowState: 'published', versionId: 2, resourceId: 3 }),
    );
    await expect(service().submitArchive(archive)).resolves.toMatchObject({
      status: 'published',
      versionId: 2,
      resourceId: 3,
    });
  });

  it('rejects a missing description before sending any submission', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const invalid = Buffer.from(
      zipSync({ 'SKILL.md': strToU8('---\nname: probe\n---\nInstructions') }),
    );
    await expect(service().submitArchive(invalid)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a personal skill with an invalid persisted manifest to BAD_REQUEST', async () => {
    const db = await getTestDB();
    const userId = `invalid-personal-${Date.now()}`;
    await db.insert(users).values({ id: userId });
    try {
      const skill = await new AgentSkillModel(db, userId).create({
        identifier: 'personal-probe',
        name: 'probe',
        description: '',
        content: 'Instructions',
        source: 'user',
        manifest: { name: 'probe', description: '' },
      });
      const fetch = vi.spyOn(globalThis, 'fetch');
      await expect(
        new SkillPublishingService(db, userId).submitPersonal(skill.id),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await db.delete(users).where(eq(users.id, userId));
    }
  }, 30000);
});
