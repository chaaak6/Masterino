// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SubmitSkillModal from './SubmitSkillModal';

const mocks = vi.hoisted(() => ({
  createFile: vi.fn(),
  upload: vi.fn(),
  submitZip: vi.fn(),
  submitPersonal: vi.fn(),
  fetchSkills: vi.fn(),
  refreshSkills: vi.fn(),
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    file: { createFile: { mutate: mocks.createFile } },
    market: {
      socialProfile: {
        submitZip: { mutate: mocks.submitZip },
        submitPersonalSkill: { mutate: mocks.submitPersonal },
      },
    },
  },
}));
vi.mock('@/services/upload', () => ({ uploadService: { uploadFileToS3: mocks.upload } }));
const state = {
  agentSkills: [
    { id: 'personal-a', name: 'Skill A', source: 'user' },
    { id: 'personal-b', name: 'Skill B', source: 'user' },
  ],
  useFetchAgentSkills: mocks.fetchSkills,
  refreshAgentSkills: mocks.refreshSkills,
};
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Modal: ({
    open,
    children,
    okText,
    cancelText,
    okButtonProps,
    cancelButtonProps,
    onOk,
    onCancel,
  }: {
    open: boolean;
    children?: ReactNode;
    okText: string;
    cancelText: string;
    okButtonProps: { disabled: boolean };
    cancelButtonProps: { disabled: boolean };
    onOk: () => void;
    onCancel: () => void;
  }) =>
    open && (
      <div role="dialog">
        {children}
        <button disabled={cancelButtonProps.disabled} onClick={onCancel}>
          {cancelText}
        </button>
        <button disabled={okButtonProps.disabled} onClick={onOk}>
          {okText}
        </button>
      </div>
    ),
  Select: ({
    value,
    options,
    onChange,
  }: {
    value?: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label="Personal skill"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('antd', () => ({
  theme: { defaultConfig: {} },
  App: { useApp: () => ({ message: mocks.message }) },
  Tabs: ({
    activeKey,
    items,
    onChange,
  }: {
    activeKey: string;
    items: { key: string; label: string; children: ReactNode }[];
    onChange: (key: string) => void;
  }) => (
    <div>
      {items.map((item) => (
        <button
          aria-selected={activeKey === item.key}
          key={item.key}
          role="tab"
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
      {items.find((item) => item.key === activeKey)?.children}
    </div>
  ),
  Upload: {
    Dragger: ({
      children,
      disabled,
      beforeUpload,
    }: {
      children: ReactNode;
      disabled: boolean;
      beforeUpload: (file: File) => void;
    }) => (
      <div>
        {children}
        <input
          aria-label="Skill ZIP"
          disabled={disabled}
          type="file"
          onChange={(event) => {
            for (const file of Array.from(event.target.files ?? [])) beforeUpload(file);
          }}
        />
      </div>
    ),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createFile.mockImplementation(async ({ name }: { name: string }) => ({
    id: `file-${name}`,
  }));
  mocks.upload.mockResolvedValue({ data: { path: 'skills/test.zip' } });
  mocks.refreshSkills.mockResolvedValue(undefined);
  mocks.submitPersonal.mockResolvedValue({ status: 'submitted' });
  mocks.submitZip.mockResolvedValue({ status: 'submitted' });
});

describe('skill submission dialog', () => {
  it('selects the requested personal skill when it arrives after mounting or changes while open', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<SubmitSkillModal open={false} onClose={onClose} />);
    rerender(<SubmitSkillModal open skillId="personal-a" onClose={onClose} />);
    expect(screen.getByRole('combobox')).toHaveValue('personal-a');
    rerender(<SubmitSkillModal open skillId="personal-b" onClose={onClose} />);
    expect(screen.getByRole('combobox')).toHaveValue('personal-b');
    fireEvent.click(screen.getByRole('button', { name: 'user.submit' }));
    await waitFor(() =>
      expect(mocks.submitPersonal).toHaveBeenCalledWith({ skillId: 'personal-b' }),
    );
    expect(mocks.submitZip).not.toHaveBeenCalled();
  });

  it('keeps controls busy until the latest accepted upload finishes', async () => {
    const first = deferred<{ data: { path: string } }>();
    const second = deferred<{ data: { path: string } }>();
    mocks.upload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<SubmitSkillModal open onClose={vi.fn()} />);
    const input = screen.getByLabelText('Skill ZIP');
    // Two selections accepted within one event batch, before disabled state is painted.
    act(() => {
      fireEvent.change(input, { target: { files: [new File(['first'], 'first.zip')] } });
      fireEvent.change(input, { target: { files: [new File(['second'], 'second.zip')] } });
    });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    await act(async () => {
      first.resolve({ data: { path: 'skills/first.zip' } });
    });
    await waitFor(() => expect(mocks.createFile).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Skill ZIP')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'user.cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'user.submit' })).toBeDisabled();
    await act(async () => {
      second.resolve({ data: { path: 'skills/second.zip' } });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'user.submit' })).toBeEnabled());
    expect(screen.getByText('second.zip')).toBeInTheDocument();
    expect(screen.queryByText('first.zip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'user.submit' }));
    await waitFor(() =>
      expect(mocks.submitZip).toHaveBeenCalledWith({ zipFileId: 'file-second.zip' }),
    );
  });

  it('keeps the selected ZIP and displays the failure inline so the same submission can be retried', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    mocks.submitZip.mockRejectedValueOnce(new Error('Market unavailable'));
    render(<SubmitSkillModal open onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('Skill ZIP'), {
      target: { files: [new File(['archive'], 'retry.zip')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'user.submit' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'user.submit' }));
    await screen.findByText('Market unavailable');
    expect(screen.getByText('retry.zip')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.message.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'user.submit' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'user.submit' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(mocks.submitZip).toHaveBeenNthCalledWith(2, { zipFileId: 'file-retry.zip' });
    expect(mocks.upload).toHaveBeenCalledOnce();
  });
});
