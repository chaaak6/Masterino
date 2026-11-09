import { describe, expect, it } from 'vitest';

import { resolveDesktopChatConfig } from './desktopAgentMode';
import { resolveToolMode } from './executionTarget';

describe('desktop mode policy', () => {
  it('overrides both legacy chat gates without changing the Web configuration', () => {
    const stored = { enableAgentMode: false, toolMode: 'chat' as const };
    expect(resolveToolMode(resolveDesktopChatConfig(stored, true))).toBe('agent');
    expect(resolveDesktopChatConfig(stored, true)?.enableAgentMode).toBe(true);
    expect(resolveDesktopChatConfig(stored, false)).toBe(stored);
    expect(stored).toEqual({ enableAgentMode: false, toolMode: 'chat' });
  });
  it('keeps a custom toolset and unrelated approval/runtime settings', () => {
    const stored = { toolMode: 'custom' as const, enableAgentMode: false, historyCount: 4 };
    expect(resolveDesktopChatConfig(stored, true)).toEqual({ ...stored, enableAgentMode: true });
    expect(resolveToolMode(resolveDesktopChatConfig(undefined, true))).toBe('agent');
  });
});
