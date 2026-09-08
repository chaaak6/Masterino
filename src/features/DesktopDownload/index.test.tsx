import { MotionProvider } from '@lobehub/ui';
import * as modal from '@lobehub/ui/base-ui';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { motion } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadDesktop, useDesktopDownload } from './index';
import * as platform from './platform';

const release = {
  artifacts: [
    { platform: 'win32', arch: 'x64', url: 'https://example.com/windows.exe' },
    { platform: 'darwin', arch: 'arm64', url: 'https://example.com/arm.dmg' },
    { platform: 'darwin', arch: 'x64', url: 'https://example.com/intel.dmg' },
  ],
  version: '1.2.7',
};
afterEach(() => vi.restoreAllMocks());

describe('desktop download interaction', () => {
  it.each(['win32/x64', 'darwin/arm64', 'darwin/x64'] as const)(
    'downloads the selected %s artifact',
    async (target) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(release));
      const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
      await downloadDesktop(target);
      expect(navigate).toHaveBeenCalledWith(
        release.artifacts.find((a) => `${a.platform}/${a.arch}` === target)?.url,
      );
    },
  );
  it('does not navigate on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    await expect(downloadDesktop('win32/x64')).rejects.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('automatically downloads without a modal when detection succeeds', async () => {
    vi.spyOn(platform, 'detectDownloadTarget').mockResolvedValue('darwin/arm64');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(release));
    const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const open = vi.spyOn(modal, 'createModal');
    const { result } = renderHook(() => useDesktopDownload());
    await act(() => result.current.download());
    expect(navigate).toHaveBeenCalledWith('https://example.com/arm.dmg');
    expect(open).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
  it('offers Mac choices and downloads the clicked architecture', async () => {
    render(
      <MotionProvider motion={motion}>
        <modal.ModalHost />
      </MotionProvider>,
    );
    vi.spyOn(platform, 'detectDownloadTarget').mockResolvedValue('mac');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(release));
    const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const { result } = renderHook(() => useDesktopDownload());
    await act(() => result.current.download());
    fireEvent.click(await screen.findByText('Intel'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://example.com/intel.dmg'));
  });
  it('retries a failed automatic download from the error dialog', async () => {
    render(
      <MotionProvider motion={motion}>
        <modal.ModalHost />
      </MotionProvider>,
    );
    vi.spyOn(platform, 'detectDownloadTarget').mockResolvedValue('win32/x64');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json(release));
    const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const { result } = renderHook(() => useDesktopDownload());
    await act(() => result.current.download());
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://example.com/windows.exe'));
  });
});
