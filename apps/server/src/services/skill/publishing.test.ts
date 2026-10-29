// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { skillFingerprint } from './publishing';

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
});
