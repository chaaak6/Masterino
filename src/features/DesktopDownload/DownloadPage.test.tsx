import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import vietnamese from '../../../locales/vi-VN/common.json';
import chinese from '../../../locales/zh-CN/common.json';
import DownloadPage from './DownloadPage';

const mocks = vi.hoisted(() => ({ download: vi.fn(), open: vi.fn(), embedded: false }));
vi.mock('./index', () => ({ downloadDesktop: mocks.download }));
vi.mock('./wecom', () => ({
  isWecomDesktop: () => mocks.embedded,
  openWecomDownloadPage: mocks.open,
}));

beforeEach(() => {
  mocks.download.mockReset();
  mocks.open.mockReset();
  mocks.embedded = false;
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0');
  window.history.replaceState({}, '', '/download');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('provides an error, usable fallback link and manual choices after SDK failure', async () => {
  mocks.embedded = true;
  mocks.open.mockRejectedValue(new Error('Signature unavailable'));
  render(<DownloadPage />);
  fireEvent.click(
    await screen.findByRole('button', { name: chinese['desktopDownload.openBrowser'] }),
  );
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(chinese['desktopDownload.browserFailed']),
  );
  expect(screen.getByRole('link')).toHaveAttribute('href', '/download?manual=1');
  expect(screen.getByRole('button', { name: 'Windows x64' })).toBeEnabled();
  expect(mocks.download).not.toHaveBeenCalled();
});

it('does not retry signed SDK or auto-download from the manual fallback URL', async () => {
  mocks.embedded = true;
  window.history.replaceState({}, '', '/download?manual=1');
  render(<DownloadPage />);
  expect(await screen.findByRole('button', { name: 'Windows x64' })).toBeEnabled();
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it('shows failure rather than silently returning when download is disabled', async () => {
  mocks.download.mockResolvedValue(undefined);
  render(<DownloadPage />);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(chinese['desktopDownload.failed']),
  );
});

it('uses the existing Vietnamese messages on the public download page', async () => {
  mocks.embedded = true;
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN');
  render(<DownloadPage />);
  expect(
    await screen.findByRole('button', { name: vietnamese['desktopDownload.openBrowser'] }),
  ).toBeVisible();
});

it('keeps the detected computer separate from the installer the user selects', async () => {
  mocks.download.mockResolvedValue('1.3.15');
  render(<DownloadPage />);
  const status = screen.getByRole('status');
  await waitFor(() => {
    expect(status).toHaveTextContent('已识别此电脑 · Windows');
    expect(status).toHaveTextContent('Windows · x64');
  });
  fireEvent.click(screen.getByRole('button', { name: 'macOS Intel' }));
  await waitFor(() => {
    expect(status).toHaveTextContent('已识别此电脑 · Windows');
    expect(status).toHaveTextContent('macOS · Intel');
    expect(status).toHaveTextContent('v1.3.15');
  });
});
