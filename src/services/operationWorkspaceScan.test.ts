import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scanOperationWorkspace } from './operationWorkspaceScan';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), desktop: true }));
vi.mock('@/const/version', () => ({
  get isDesktop() {
    return mocks.desktop;
  },
}));
vi.mock('@/services/projectSkill', () => ({ projectSkillService: { scanWorkspace: mocks.scan } }));
vi.mock('@/store/electron', () => ({
  useElectronStore: { getState: () => ({ gatewayDeviceInfo: { deviceId: 'local' } }) },
}));
beforeEach(() => {
  mocks.desktop = true;
  mocks.scan.mockReset();
});
describe('operation workspace scan', () => {
  it('scans a new local workspace without a settings cache', async () => {
    mocks.scan.mockResolvedValue({
      skills: [{ name: 'demo', path: '/repo/.agents/skills/demo/SKILL.md' }],
      instructions: [],
    });
    const result = await scanOperationWorkspace({
      kind: 'device',
      deviceId: 'local',
      rootPath: '/repo',
    });
    expect(result?.skills[0]?.name).toBe('demo');
    expect(mocks.scan).toHaveBeenCalledWith({ scope: '/repo', deviceId: undefined });
  });
  it('uses the selected remote device and propagates scan failure', async () => {
    mocks.scan.mockRejectedValue(new Error('offline'));
    await expect(
      scanOperationWorkspace({ kind: 'device', deviceId: 'remote', rootPath: '/repo' }),
    ).rejects.toThrow('offline');
    expect(mocks.scan).toHaveBeenCalledWith({ scope: '/repo', deviceId: 'remote' });
  });
  it('skips an unbound topic and discovers skills created in scratch', async () => {
    await scanOperationWorkspace();
    expect(mocks.scan).not.toHaveBeenCalled();
    await scanOperationWorkspace({ kind: 'scratch', deviceId: 'local', rootPath: '/scratch' });
    expect(mocks.scan).toHaveBeenCalledWith({ deviceId: undefined, scope: '/scratch' });
  });
});
