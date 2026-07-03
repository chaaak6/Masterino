import { describe, expect, it } from 'vitest';

import { supervisorSystemRole } from '../../packages/builtin-agents/src/agents/group-supervisor/systemRole';
import { INBOX } from '../../packages/builtin-agents/src/agents/inbox';
import { TASK_AGENT } from '../../packages/builtin-agents/src/agents/task-agent';
import { VERIFY_AGENT } from '../../packages/builtin-agents/src/agents/verify-agent';
import { WEB_ONBOARDING } from '../../packages/builtin-agents/src/agents/web-onboarding';

describe('MasterLion builtin agent branding', () => {
  it('uses the MasterLion avatar for default user-facing builtin agents', () => {
    expect(INBOX.avatar).toBe('/brand/masterlion/avatar.png');
    expect(TASK_AGENT.avatar).toBe('/brand/masterlion/avatar.png');
    expect(VERIFY_AGENT.avatar).toBe('/brand/masterlion/avatar.png');
    expect(WEB_ONBOARDING.avatar).toBe('/brand/masterlion/avatar.png');
  });

  it('describes the group supervisor as MasterLion instead of LobeAI', () => {
    expect(supervisorSystemRole).toContain('You are MasterLion');
    expect(supervisorSystemRole).not.toContain('LobeAI');
    expect(supervisorSystemRole).not.toContain('LobeHub');
  });

  it('describes the inbox agent as 小宗狮AI instead of Lobe', () => {
    const runtime = typeof INBOX.runtime === 'function' ? INBOX.runtime({}) : INBOX.runtime;
    const role = runtime.systemRole ?? '';
    expect(role).toContain('小宗狮AI');
    expect(role).not.toContain('You are Lobe');
    expect(role).not.toContain('LobeAI');
    expect(role).not.toContain('LobeHub');
  });
});
