// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CatalogCreate from './CatalogCreate';

const actions = vi.hoisted(() => ({ create: vi.fn(), reset: vi.fn() }));
vi.mock('@admin/lib/trpc', () => ({
  trpcClient: { upload: { createS3PreSignedUpload: { mutate: () => new Promise(() => {}) } } },
  trpc: {
    admin: {
      verifyCatalogMcp: { useMutation: () => ({ reset: actions.reset, mutate: vi.fn() }) },
      createCatalogResource: { useMutation: () => ({ mutate: actions.create }) },
    },
  },
}));

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  actions.create.mockClear();
});
describe('Skill ZIP removal', () => {
  it('shows upload progress instead of requiring handwritten content while a ZIP is uploading', async () => {
    render(<CatalogCreate type="skill" onCancel={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('标识符'), { target: { value: 'uploading' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Uploading' } });
    fireEvent.change(screen.getByLabelText('Skill ZIP'), {
      target: { files: [new File(['archive'], 'example.zip')] },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
    await waitFor(() => expect(screen.getByText('ZIP 正在上传，请稍后提交')).toBeTruthy());
    expect(actions.create).not.toHaveBeenCalled();
  });
  it('Given a selected ZIP, When removed, Then handwritten content is preserved and submitted without the ZIP', async () => {
    render(<CatalogCreate type="skill" onCancel={() => {}} onCreated={() => {}} />);
    const content = screen.getByLabelText('SKILL.md 内容') as HTMLTextAreaElement;
    fireEvent.change(content, {
      target: { value: '---\nname: handwritten\ndescription: test\n---\nInstructions' },
    });
    const input = screen.getByLabelText('Skill ZIP') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['archive'], 'example.zip')] } });
    await waitFor(() => expect(content.disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '移除 ZIP' }));
    expect(content.disabled).toBe(false);
    expect(content.value).toContain('name: handwritten');
    expect(input.value).toBe('');
    fireEvent.change(screen.getByLabelText('标识符'), { target: { value: 'handwritten' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Handwritten' } });
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
    await waitFor(() =>
      expect(actions.create).toHaveBeenCalledWith(
        expect.objectContaining({ artifactFileId: undefined, skillContent: content.value }),
      ),
    );
    fireEvent.change(input, { target: { files: [new File(['archive'], 'example.zip')] } });
    await waitFor(() => expect(content.disabled).toBe(true));
  });
});
