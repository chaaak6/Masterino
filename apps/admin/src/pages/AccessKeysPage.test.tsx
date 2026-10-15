// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  create: vi.fn(),
  reveal: vi.fn(),
  setEnabled: vi.fn(),
  delete: vi.fn(),
  invalidate: vi.fn(async () => {}),
  refetch: vi.fn(),
}));
vi.mock('@admin/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ admin: { managedApiKeys: { list: { invalidate: actions.invalidate } } } }),
    admin: {
      managedApiKeys: {
        list: {
          useQuery: () => ({
            data: {
              items: [
                {
                  id: 'managed-key',
                  name: 'Agent import',
                  description: 'Resource submissions',
                  ownerName: 'Admin A',
                  enabled: true,
                  createdAt: new Date('2026-10-12T00:00:00Z'),
                  expiresAt: null,
                  lastUsedAt: null,
                },
              ],
              total: 1,
            },
            isLoading: false,
            isFetching: false,
            refetch: actions.refetch,
          }),
        },
        create: { useMutation: () => ({ mutate: actions.create, isPending: false }) },
        reveal: {
          useMutation: (options: any) => ({
            mutate: (input: any) => {
              actions.reveal(input);
              options.onSuccess({ key: 'sk-lh-browser-test' }, input);
            },
            isPending: false,
            reset: vi.fn(),
          }),
        },
        setEnabled: { useMutation: () => ({ mutate: actions.setEnabled, isPending: false }) },
        delete: { useMutation: () => ({ mutate: actions.delete, isPending: false }) },
      },
    },
  },
}));
import AccessKeysPage from './AccessKeysPage';
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
describe('Access Key management UI', () => {
  it('Given the catalog, Then Key text is hidden until viewed and can be hidden again', async () => {
    render(<AccessKeysPage />);
    expect(screen.queryByText('sk-lh-browser-test')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(await screen.findByText('sk-lh-browser-test')).toBeTruthy();
    expect(actions.reveal).toHaveBeenCalledWith({ id: 'managed-key' });
    fireEvent.click(screen.getByRole('button', { name: '隐藏' }));
    expect(screen.queryByText('sk-lh-browser-test')).toBeNull();
  });
  it('When creating a Key, Then name and purpose are submitted after form validation', async () => {
    render(<AccessKeysPage />);
    fireEvent.click(screen.getByRole('button', { name: '创建访问 Key' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'CLI import' } });
    fireEvent.change(screen.getByLabelText('用途'), { target: { value: 'Upload Skill' } });
    fireEvent.click(screen.getByRole('button', { name: /^创\s*建$/ }));
    await waitFor(() =>
      expect(actions.create).toHaveBeenCalledWith({
        name: 'CLI import',
        description: 'Upload Skill',
        expiresAt: null,
      }),
    );
  });
  it('When disabling a Key, Then only that Key is targeted; deletion requires an explicit second action', () => {
    render(<AccessKeysPage />);
    fireEvent.click(screen.getByRole('button', { name: /停\s*用/ }));
    expect(actions.setEnabled).toHaveBeenCalledWith({ id: 'managed-key', enabled: false });
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }));
    expect(actions.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(actions.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /删\s*除/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(actions.delete).toHaveBeenCalledWith({ id: 'managed-key' });
  });
});
