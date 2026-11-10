import { toast } from '@lobehub/ui/base-ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { localFileService } from '@/services/electron/localFileService';

import { LocalFile } from './LocalFile';

// Keep UI coverage to the action contract; layout and popover positioning are not tested here.
vi.mock('@lobehub/ui', () => ({
  Button: ({ icon: _icon, ...props }: any) => <button {...props} />,
  Flexbox: ({ children, onClick }: any) => <span onClick={onClick}>{children}</span>,
  Popover: ({ children, content }: any) => (
    <>
      {children}
      {content}
    </>
  ),
}));
vi.mock('@/components/FileIcon', () => ({ default: () => null }));
afterEach(() => vi.restoreAllMocks());
it('surfaces a resolved OS failure and an IPC rejection for the two actions', async () => {
  const notify = vi.spyOn(toast, 'error').mockImplementation(() => 'test');
  vi.spyOn(localFileService, 'openLocalFileOrFolder').mockResolvedValue({
    success: false,
    error: 'not found',
  });
  vi.spyOn(localFileService, 'openFileFolder').mockRejectedValue(new Error('IPC unavailable'));
  render(<LocalFile name="报告.pptx" path="/tmp/a b.pptx" />);
  fireEvent.click(screen.getByTitle('LocalFile.action.open'));
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTitle('LocalFile.action.showInFolder'));
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
});
it('reports a missing path without calling IPC', () => {
  const notify = vi.spyOn(toast, 'error').mockImplementation(() => 'test');
  const open = vi.spyOn(localFileService, 'openLocalFileOrFolder');
  render(<LocalFile name="无效链接" />);
  fireEvent.click(screen.getByTitle('LocalFile.action.open'));
  expect(notify).toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
