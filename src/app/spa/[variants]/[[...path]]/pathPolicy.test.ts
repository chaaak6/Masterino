import { describe, expect, it } from 'vitest';

import { classifySpaPath } from './pathPolicy';

describe('classifySpaPath', () => {
  it.each([
    [[], 'known'],
    [['agent', 'inbox'], 'known'],
    [['share', 't', 'topic-id'], 'known'],
    [['onboarding', 'agent'], 'known'],
    [['acme'], 'workspace'],
    [['definitely-not-a-route'], 'workspace'],
    [['wp-admin'], 'workspace'],
    [['acme', 'settings', 'members'], 'workspace'],
    [['acme', 'agent', 'agent-id', 'task', 'task-id'], 'workspace'],
  ])('classifies %j as %s', (path, expected) => {
    expect(classifySpaPath(path)).toBe(expected);
  });

  it.each([
    { path: ['.git', 'config'] },
    { path: ['acme', 'not-a-workspace-route'] },
    { path: ['agent', 'agent-id', 'topic-id', 'extra'] },
    { path: ['community', 'agent', 'slug', 'extra'] },
    { path: ['share', 'arbitrary-id'] },
    { path: ['share', 't', 'topic-id', 'extra'] },
    { path: ['acme', 'settings', 'members', 'extra'] },
  ])('rejects unknown SPA paths: $path', ({ path }) => {
    expect(classifySpaPath(path)).toBe('unknown');
  });
});
