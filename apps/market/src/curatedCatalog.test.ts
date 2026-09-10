import { describe, expect, it } from 'vitest';

import { validateZipArchive } from './crypto.js';
import {
  CURATED_AGENT_SEED_BATCH,
  CURATED_SEED_BATCH,
  curatedResources,
  rejectedLobehubCandidates,
} from './curatedCatalog.js';
import { createStoredZip } from './zip.js';
import { ONBOARDING_AGENT_CATALOG } from './onboardingCatalog.js';

describe('curated community catalog', () => {
  it('contains fifty assistants and five candidates for each other community type', () => {
    const counts = curatedResources.reduce<Record<string, number>>((result, item) => {
      result[item.type] = (result[item.type] || 0) + 1;
      return result;
    }, {});

    expect(counts).toEqual({ agent: 50, mcp: 5, skill: 5 });
    expect(new Set(curatedResources.map((item) => item.resource.identifier)).size).toBe(60);
    expect(curatedResources.some((item) => ['model', 'provider'].includes(item.type))).toBe(false);
  });

  it('keeps the eight onboarding templates aligned with the product catalog', () => {
    const resources = new Map(
      curatedResources.map((entry) => [entry.resource.identifier, entry.resource]),
    );
    for (const entry of ONBOARDING_AGENT_CATALOG) {
      expect(resources.get(entry.identifier)).toMatchObject({
        avatar: entry.avatar,
        category: entry.category,
        version: entry.seedVersion,
      });
    }
  });

  it('publishes five reviewed LobeHub directions in each public assistant category', () => {
    const lobehubAgents = curatedResources.filter(
      (item) => item.type === 'agent' && item.resource.metadata.sourceCatalog === 'lobehub.com',
    );
    const sourceCategoryCounts = lobehubAgents.reduce<Record<string, number>>((result, item) => {
      const sourceCategory = item.resource.tags[1];
      result[sourceCategory] = (result[sourceCategory] || 0) + 1;
      return result;
    }, {});

    expect(sourceCategoryCounts).toEqual({
      academic: 5,
      career: 5,
      copywriting: 5,
      design: 5,
      education: 5,
      general: 5,
      office: 5,
      programming: 5,
      translation: 5,
    });
    expect(lobehubAgents.every((item) => item.seedBatchId === CURATED_AGENT_SEED_BATCH)).toBe(true);
    expect(
      lobehubAgents.every(
        (item) =>
          item.resource.metadata.adaptation === 'internal-rewrite' &&
          item.resource.metadata.reviewDecision === 'approved-internal-rewrite' &&
          item.resource.metadata.sourceSnapshotAt === '2026-08-11T00:00:00.000Z',
      ),
    ).toBe(true);
  });

  it('keeps rejected unsafe or incompatible LobeHub candidates out of the catalog', () => {
    const identifiers = new Set(
      curatedResources.map((item) => item.resource.metadata?.sourceIdentifier).filter(Boolean),
    );

    for (const rejected of rejectedLobehubCandidates) {
      expect(identifiers.has(rejected.sourceIdentifier)).toBe(false);
    }
  });

  it('records traceable internal rewrites for every SkillHub-inspired skill', () => {
    const skills = curatedResources.filter((item) => item.type === 'skill');

    for (const item of skills) {
      expect(item.resource.identifier).not.toBe('office-documents');
      expect(item.resource.metadata).toMatchObject({
        adaptation: 'internal-rewrite',
        seedBatchId: CURATED_SEED_BATCH,
        sourceCatalog: 'skillhub.cn',
      });
      expect(item.resource.metadata.sourceUrl).toMatch(/^https:\/\/skillhub\.cn\/skills\//);
      expect(item.resource.metadata.sourceIdentifier).toBeTruthy();
      expect(item.resource.metadata.sourceAuthor).toBeTruthy();
      expect(item.resource.metadata.sourceVersion).toBe('catalog-snapshot-2026-08-07');
      expect(item.resource.metadata.license).toBe('Masterino-internal');
      expect(item.resource.metadata.reviewedAt).toBeTruthy();
    }
  });

  it('builds safe deterministic ZIP packages for curated skills', () => {
    for (const item of curatedResources.filter((candidate) => candidate.artifact)) {
      const first = createStoredZip(item.artifact!.files);
      const second = createStoredZip(item.artifact!.files);

      expect(first.equals(second)).toBe(true);
      expect(validateZipArchive(first)).toEqual([]);
    }
  });

  it('uses remote HTTP MCP manifests with explicit auth modes', () => {
    for (const item of curatedResources.filter((candidate) => candidate.type === 'mcp')) {
      const connection = item.resource.manifest.deploymentOptions[0].connection;
      expect(connection.type).toBe('http');
      expect(connection.url).toMatch(/^https:\/\//);
      expect(['none', 'oauth2']).toContain(connection.auth.type);
    }
  });
});
