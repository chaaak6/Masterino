import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import type { ParsedZipSkill } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { zipSync } from 'fflate';
import matter from 'gray-matter';
import { z } from 'zod';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { UserModel } from '@/database/models/user';
import { generateTrustedClientToken } from '@/libs/trusted-client';
import { getInternalMarketBaseUrl } from '@/utils/internalMarket';

import { SkillManifestError, SkillParseError } from './errors';
import { SkillParser } from './parser';
import { SkillResourceService } from './resource';
import { assertSafeSkillPackageContent } from './submissionPolicy';

const submissionResponseSchema = z.object({
  resourceId: z.number().int().positive(),
  versionId: z.number().int().positive(),
  workflowState: z.enum([
    'submitted',
    'scanning',
    'in_review',
    'approved',
    'rejected',
    'published',
    'deprecated',
  ]),
});

async function parsePublishingArchive(archive: Buffer) {
  try {
    return await new SkillParser().parseZipPackage(archive, { repackSkillZip: true });
  } catch (error) {
    if (error instanceof SkillManifestError || error instanceof SkillParseError)
      throw new TRPCError({ code: 'BAD_REQUEST', cause: error, message: error.message });
    throw error;
  }
}

const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const submissionIdentifier = (
  userId: string,
  workspaceId: string | undefined,
  source: string,
) =>
  `user-${createHash('sha256')
    .update(JSON.stringify([userId, workspaceId ?? null, source]))
    .digest('hex')
    .slice(0, 24)}`;

export const skillFingerprint = (skill: {
  content: string;
  manifest: unknown;
  resources?: Map<string, Buffer>;
}) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        canonical(skill.manifest),
        skill.content.trim(),
        [...(skill.resources ?? new Map())]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]),
      ]),
    )
    .digest('hex');

async function publicationArchive(skill: ParsedZipSkill) {
  // The version uses the semantic fingerprint, so its artifact must ignore
  // source YAML formatting, key order and surrounding body whitespace too.
  const files: Record<string, Uint8Array> = {
    'SKILL.md': new TextEncoder().encode(
      matter.stringify(skill.content.trim(), canonical(skill.manifest)),
    ),
  };
  for (const path of [...skill.resources.keys()].sort()) files[path] = skill.resources.get(path)!;
  // Reuse the parser's size validation, sorted entries and fixed ZIP timestamp.
  const parsed = await parsePublishingArchive(Buffer.from(zipSync(files)));
  return parsed.skillZipBuffer!;
}

/** Rebuild from current content, never from a potentially stale imported ZIP. */
export async function exportPersonalSkill(
  db: LobeChatDatabase,
  userId: string,
  id: string,
  workspaceId?: string,
) {
  const skill = await new AgentSkillModel(db, userId, workspaceId).findById(id);
  if (!skill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
  let resources: SkillResourceService | undefined;
  const files: Record<string, Uint8Array> = {
    'SKILL.md': new TextEncoder().encode(matter.stringify(skill.content ?? '', skill.manifest)),
  };
  const resourceBytes = new Map<string, Buffer>();
  for (const path of Object.keys(skill.resources ?? {}).sort()) {
    resources ??= new SkillResourceService(db, userId, workspaceId);
    const resource = await resources.readResource(skill.resources!, path);
    const bytes = Buffer.from(resource.content, resource.encoding === 'base64' ? 'base64' : 'utf8');
    files[path] = bytes;
    resourceBytes.set(path, bytes);
  }
  const archive = Buffer.from(zipSync(files));
  const parsed = await parsePublishingArchive(archive);
  return {
    archive: parsed.skillZipBuffer!,
    hash: skillFingerprint({
      content: skill.content ?? '',
      manifest: skill.manifest,
      resources: resourceBytes,
    }),
    skill,
  };
}

export class SkillPublishingService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}
  async submitPersonal(id: string) {
    const model = new AgentSkillModel(this.db, this.userId, this.workspaceId);
    const selected = (await model.findById(id)) ?? (await model.findByIdentifier(id));
    if (!selected) throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
    const { archive, skill, hash } = await exportPersonalSkill(
      this.db,
      this.userId,
      selected.id,
      this.workspaceId,
    );
    if (skill.source !== 'user')
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only your own skills can be submitted.',
      });
    const result = await this.submitArchive(archive, `personal:${skill.id}`);
    await model.update(skill.id, {
      editorData: { ...skill.editorData, publication: { identifier: result.identifier, hash } },
    });
    return result;
  }
  async submitArchive(archive: Buffer, sourceRef?: string) {
    if (this.workspaceId)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Submit from your personal library; organization submissions are not supported here.',
      });
    const parsed = await parsePublishingArchive(archive);
    assertSafeSkillPackageContent(parsed);
    const normalizedArchive = await publicationArchive(parsed);
    const hash = skillFingerprint(parsed);
    const identifier = submissionIdentifier(
      this.userId,
      this.workspaceId,
      sourceRef ?? parsed.manifest.name,
    );
    const user = await UserModel.findById(this.db, this.userId);
    if (!user?.email)
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in before submitting a skill.' });
    const token = generateTrustedClientToken({
      userId: this.userId,
      email: user.email,
      name: user.fullName || user.username || undefined,
      ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
    });
    if (!token)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Market is not configured.' });
    const form = new FormData();
    form.set(
      'file',
      new Blob([new Uint8Array(normalizedArchive)], { type: 'application/zip' }),
      `${identifier}.zip`,
    );
    form.set(
      'manifest',
      JSON.stringify({
        ...parsed.manifest,
        files: [
          { path: 'SKILL.md', type: 'file' },
          ...[...parsed.resources.keys()].map((path) => ({ path, type: 'file' })),
        ],
      }),
    );
    form.set('metadata', JSON.stringify({ sourceCatalog: 'user-submission' }));
    form.set('name', parsed.manifest.name);
    form.set('description', parsed.manifest.description);
    form.set('version', `1.0.0-${hash.slice(0, 16)}`);
    const response = await fetch(
      `${getInternalMarketBaseUrl()}/api/v1/user/skills/${identifier}/submission`,
      {
        method: 'POST',
        headers: { 'x-lobe-trust-token': token },
        body: form,
        signal: AbortSignal.timeout(90000),
      },
    );
    const result: unknown = await response.json().catch(() => undefined);
    if (!response.ok)
      throw new TRPCError({
        code:
          response.status === 409
            ? 'CONFLICT'
            : response.status >= 500
              ? 'BAD_GATEWAY'
              : 'BAD_REQUEST',
        message:
          result &&
          typeof result === 'object' &&
          'error' in result &&
          typeof result.error === 'string'
            ? result.error
            : `Skill submission failed (HTTP ${response.status})`,
      });
    const validated = submissionResponseSchema.safeParse(result);
    if (!validated.success)
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message:
          'Market returned an invalid skill submission response. Retry to confirm the submission status.',
      });
    return { ...validated.data, identifier, status: validated.data.workflowState, hash };
  }
}
