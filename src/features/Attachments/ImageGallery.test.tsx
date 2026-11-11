import { MotionProvider } from '@lobehub/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { m } from 'motion/react';
import { expect, it, vi } from 'vitest';

import ImageGallery from './ImageGallery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => (options?.ns ? `${options.ns}:${key}` : key),
  }),
}));

it('refreshes a failed uploaded image and uses the new URL in the preview and thumbnail', async () => {
  const expired = 'https://example.test/expired.png';
  const fresh = 'https://example.test/fresh.png';
  let finish!: (url: string) => void;
  const load = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <MotionProvider motion={m}>
      <ImageGallery items={[{ id: 'uploaded:1', load, name: 'Image', url: expired }]} />
    </MotionProvider>,
  );

  const thumbnail = screen.getByRole('button', { name: 'Image' });
  fireEvent.click(thumbnail);
  const dialog = within(await screen.findByRole('dialog'));
  const preview = dialog.getByRole('img', { name: 'Image' });
  expect(preview).toHaveAttribute('src', expired);
  expect(load).not.toHaveBeenCalled();

  fireEvent.error(preview);
  fireEvent.click(dialog.getByRole('button', { name: 'attachments.retry' }));
  expect(load).toHaveBeenCalledOnce();
  expect(dialog.getByRole('status')).toHaveTextContent('common:loading');

  finish(fresh);
  expect(await dialog.findByRole('img', { name: 'Image' })).toHaveAttribute('src', fresh);
  expect(thumbnail.querySelector('img')).toHaveAttribute('src', fresh);
});
