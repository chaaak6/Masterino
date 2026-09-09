import { describe, expect, it } from 'vitest';

import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';
import type { ChatTopic } from '@/types/topic';

import {
  assertDisjointTopicNavigation,
  buildWorkspaceTopicNavigation,
  classifyTopicForNavigation,
  readTopicExecutionSnapshot,
} from './topicNavigation';

const topic = (id: string, over: Partial<ChatTopic> = {}): ChatTopic => ({
  createdAt: 1,
  id,
  title: id,
  updatedAt: 1,
  ...over,
});

const workspace = (id: string, over: Partial<ProjectWorkspaceItem> = {}): ProjectWorkspaceItem => ({
  deviceId: 'device-1',
  id,
  kind: 'device',
  rootPath: `/projects/${id}`,
  ...over,
});

const snapshotMeta = (workspaceId: string, workspaceKind: 'device' | 'sandbox' | 'scratch') => ({
  executionSnapshot: {
    boundDeviceId: 'device-1',
    target: 'local' as const,
    targetCapturedAt: '2026-09-03T00:00:00.000Z',
    version: 1 as const,
    workspaceBoundAt: '2026-09-03T00:00:00.000Z',
    workspaceId,
    workspaceKind,
  },
});

describe('buildWorkspaceTopicNavigation', () => {
  const workspacesById = {
    'ws-a': workspace('ws-a'),
    'ws-b': workspace('ws-b'),
    'ws-sandbox': workspace('ws-sandbox', {
      deviceId: undefined,
      kind: 'sandbox',
      rootPath: '/workspace',
    }),
    'ws-scratch': workspace('ws-scratch', { kind: 'scratch', rootPath: '/tmp/scratch/t' }),
  };

  it('puts unbound, scratch and project-less sandbox topics only in recent', () => {
    const navigation = buildWorkspaceTopicNavigation(
      [
        topic('unbound'),
        topic('scratch', { metadata: snapshotMeta('ws-scratch', 'scratch') as any }),
        topic('sandbox', { metadata: snapshotMeta('ws-sandbox', 'sandbox') as any }),
      ],
      { topicStatesById: {}, workspacesById },
    );

    expect(navigation.workspaceGroups).toEqual([]);
    expect(navigation.recent.map((entry) => [entry.topic.id, entry.placement.reason])).toEqual([
      ['unbound', 'unbound'],
      ['scratch', 'scratch'],
      ['sandbox', 'sandbox-without-project'],
    ]);
  });

  it('groups formal workspace topics by workspace id only, never by raw path', () => {
    const navigation = buildWorkspaceTopicNavigation(
      [
        topic('a1', { metadata: snapshotMeta('ws-a', 'device') as any, updatedAt: 10 }),
        topic('b1', { metadata: snapshotMeta('ws-b', 'device') as any, updatedAt: 30 }),
        topic('a2', { metadata: snapshotMeta('ws-a', 'device') as any, updatedAt: 20 }),
      ],
      { topicStatesById: {}, workspacesById },
    );

    expect(navigation.workspaceGroups.map((group) => group.workspaceId)).toEqual(['ws-b', 'ws-a']);
    expect(
      navigation.workspaceGroups.every((group) => !group.workspaceId.startsWith('project:')),
    ).toBe(true);
    expect(navigation.workspaceGroups[1].topics.map((item) => item.id)).toEqual(['a2', 'a1']);
    expect(navigation.recent).toEqual([]);
  });

  it('keeps workspace and recent sets disjoint', () => {
    const topics = [
      topic('bound', { metadata: snapshotMeta('ws-a', 'device') as any }),
      topic('plain'),
      topic('scratch', { metadata: snapshotMeta('ws-scratch', 'scratch') as any }),
    ];
    const navigation = buildWorkspaceTopicNavigation(topics, {
      topicStatesById: {},
      workspacesById,
    });

    const grouped = new Set(navigation.workspaceGroups.flatMap((g) => g.topics.map((t) => t.id)));
    const recent = new Set(navigation.recent.map((entry) => entry.topic.id));
    for (const id of grouped) expect(recent.has(id)).toBe(false);
    expect(grouped.size + recent.size).toBe(topics.length);
    expect(() => assertDisjointTopicNavigation(navigation)).not.toThrow();
  });

  it('assertDisjointTopicNavigation throws on a duplicated topic', () => {
    const duplicated = topic('dup');
    expect(() =>
      assertDisjointTopicNavigation({
        placementById: {},
        recent: [{ placement: { kind: 'recent', reason: 'unbound' }, topic: duplicated }],
        workspaceGroups: [{ topics: [duplicated], workspaceId: 'ws-a' }],
      }),
    ).toThrow(/appears twice/);
  });

  it('prefers loaded topic state over metadata', () => {
    const navigation = buildWorkspaceTopicNavigation([topic('t')], {
      topicStatesById: {
        t: {
          snapshot: {
            target: 'local',
            targetCapturedAt: '',
            version: 1,
            workspaceId: 'ws-b',
            workspaceKind: 'device',
          },
          workspace: {
            deviceId: 'device-1',
            id: 'ws-b',
            kind: 'device',
            rootPath: '/projects/ws-b',
          },
        },
      },
      workspacesById,
    });
    expect(navigation.workspaceGroups[0].workspaceId).toBe('ws-b');
  });

  it('uses the transitional server projection (metadata.workspaceId) when no snapshot exists', () => {
    const navigation = buildWorkspaceTopicNavigation(
      [topic('t', { metadata: { workspaceId: 'ws-a', workspaceKind: 'device' } as any })],
      { topicStatesById: {}, workspacesById },
    );
    expect(navigation.workspaceGroups[0].workspaceId).toBe('ws-a');
  });

  it('matches legacy workingDirectory evidence to a persisted workspace id, otherwise recent', () => {
    const legacyKnown = topic('known', {
      metadata: { boundDeviceId: 'device-1', workingDirectory: '/projects/ws-a/' },
    });
    const legacyUnknown = topic('unknown', {
      metadata: { boundDeviceId: 'device-1', workingDirectory: '/somewhere/else' },
    });
    const noDevice = topic('nodevice', { metadata: { workingDirectory: '/projects/ws-a' } });

    const navigation = buildWorkspaceTopicNavigation([legacyKnown, legacyUnknown, noDevice], {
      topicStatesById: {},
      workspacesById,
    });

    expect(navigation.workspaceGroups.map((group) => group.workspaceId)).toEqual(['ws-a']);
    expect(navigation.recent.map((entry) => entry.topic.id).sort()).toEqual([
      'nodevice',
      'unknown',
    ]);
  });

  it('restores raw legacy directory groups only when the old-server compatibility mode is active', () => {
    const legacyWithDevice = topic('legacy-device', {
      metadata: { boundDeviceId: 'device-1', workingDirectory: '/legacy/app/' },
      updatedAt: 20,
    });
    const legacyWithoutDevice = topic('legacy-no-device', {
      metadata: { workingDirectory: '/legacy/app' },
      updatedAt: 10,
    });

    const navigation = buildWorkspaceTopicNavigation(
      [legacyWithDevice, legacyWithoutDevice, topic('plain')],
      {
        allowLegacyPathGroups: true,
        topicStatesById: {},
        workspacesById: {},
      },
    );

    expect(navigation.workspaceGroups).toHaveLength(1);
    expect(navigation.workspaceGroups[0]).toMatchObject({
      legacyWorkingDirectory: '/legacy/app',
      topics: [{ id: 'legacy-device' }, { id: 'legacy-no-device' }],
      workspace: { kind: 'device', rootPath: '/legacy/app' },
    });
    expect(navigation.workspaceGroups[0].workspaceId).toMatch(/^legacy-directory:/);
    expect(navigation.placementById['legacy-device']).toEqual({
      kind: 'legacy-directory',
      workingDirectory: '/legacy/app',
    });
    expect(navigation.recent.map((entry) => entry.topic.id)).toEqual(['plain']);
  });

  it('sorts recent by updatedAt with favorites pinned first', () => {
    const navigation = buildWorkspaceTopicNavigation(
      [
        topic('old', { updatedAt: 1 }),
        topic('fav', { favorite: true, updatedAt: 2 }),
        topic('new', { updatedAt: 3 }),
      ],
      { topicStatesById: {}, workspacesById: {} },
    );
    expect(navigation.recent.map((entry) => entry.topic.id)).toEqual(['fav', 'new', 'old']);
  });

  it('exposes the scratch workspace so the row can render its tag', () => {
    const navigation = buildWorkspaceTopicNavigation(
      [topic('scratch', { metadata: snapshotMeta('ws-scratch', 'scratch') as any })],
      { topicStatesById: {}, workspacesById },
    );
    expect(navigation.recent[0].placement).toEqual({ kind: 'recent', reason: 'scratch' });
    expect(navigation.recent[0].workspace?.rootPath).toBe('/tmp/scratch/t');
  });

  it('classifies a sandbox workspace with repository identity as a workspace topic', () => {
    const result = classifyTopicForNavigation(
      topic('s', { metadata: snapshotMeta('ws-repo', 'sandbox') as any }),
      {
        topicStatesById: {},
        workspacesById: {
          'ws-repo': workspace('ws-repo', {
            deviceId: undefined,
            kind: 'sandbox',
            repoType: 'github',
            rootPath: '/workspace',
          }),
        },
      },
    );
    expect(result.placement).toEqual({ kind: 'workspace', workspaceId: 'ws-repo' });
  });

  it('never synthesizes a snapshot for the effective-workspace resolver', () => {
    expect(
      readTopicExecutionSnapshot(
        topic('t', { metadata: { workspaceId: 'ws-a', workspaceKind: 'device' } as any }),
      ),
    ).toBeUndefined();
  });
});

describe('desktop project isolation', () => {
  const local = workspace('local', { deviceId: 'mac-a', rootPath: '/same/path' });
  const remote = workspace('remote', { deviceId: 'mac-b', rootPath: '/same/path' });
  const project = (id: string, deviceId: string) =>
    topic(id, {
      metadata: {
        executionSnapshot: {
          ...snapshotMeta(id, 'device').executionSnapshot,
          boundDeviceId: deviceId,
        },
      },
    });
  const topics = [project('local', 'mac-a'), project('remote', 'mac-b'), topic('plain')];
  const context = { topicStatesById: {}, workspacesById: { local, remote } };

  it('keeps only this device project even when another Mac has the same path', () => {
    const result = buildWorkspaceTopicNavigation(topics, { ...context, currentDeviceId: 'mac-a' });
    expect(result.workspaceGroups.map((g) => g.workspaceId)).toEqual(['local']);
    expect(result.recent.map((e) => e.topic.id)).toEqual(['plain']);
    expect(result.placementById.remote).toBeUndefined();
  });

  it('does not leak projects while device identity is loading; web remains shared', () => {
    expect(
      buildWorkspaceTopicNavigation(topics, { ...context, currentDeviceId: null }).workspaceGroups,
    ).toEqual([]);
    expect(buildWorkspaceTopicNavigation(topics, context).workspaceGroups).toHaveLength(2);
  });

  it('hides foreign projects even without a loaded workspace row', () => {
    const result = buildWorkspaceTopicNavigation(topics, {
      topicStatesById: {},
      workspacesById: {},
      currentDeviceId: 'mac-a',
    });
    expect(result.placementById.remote).toBeUndefined();
  });

  it('hides legacy unidentified paths but keeps scratch and ordinary chat history', () => {
    const result = buildWorkspaceTopicNavigation(
      [
        topic('legacy', { metadata: { workingDirectory: '/same/path' } }),
        topic('scratch', { metadata: snapshotMeta('scratch', 'scratch') }),
        topic('plain'),
      ],
      { ...context, currentDeviceId: 'mac-a', allowLegacyPathGroups: true },
    );
    expect(result.placementById.legacy).toBeUndefined();
    expect(Object.keys(result.placementById)).toEqual(['scratch', 'plain']);
  });
});
