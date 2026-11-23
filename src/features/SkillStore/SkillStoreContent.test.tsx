import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSkillStoreModal } from '.';
import { SkillStoreContent } from './SkillStoreContent';

const env = vi.hoisted(() => ({ isDesktop: true }));
const modal = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('@/const/version', () => ({
  get isDesktop() {
    return env.isDesktop;
  },
}));
vi.mock('@/layout/AuthProvider/MarketAuth', () => ({
  MarketAuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@lobehub/ui/base-ui', () => ({ createModal: modal.create }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
  Segmented: ({
    onChange,
    options,
    value,
  }: {
    onChange: (value: string) => void;
    options: { label: string; value: string }[];
    value: string;
  }) => (
    <div data-testid="segmented" data-value={value}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('./Search', () => ({
  default: ({ activeTab }: { activeTab: string }) => <div data-testid="search">{activeTab}</div>,
}));

vi.mock('./SkillList/AddSkillButton', () => ({
  default: ({ onAddLocal }: { onAddLocal?: () => void }) => (
    <button type="button" onClick={onAddLocal}>
      add
    </button>
  ),
}));

vi.mock('./SkillList/DeviceLocalMcpPanel', () => ({
  default: ({ addOpen, onAdd }: { addOpen: boolean; onAdd: () => void }) => (
    <section>
      <button type="button" onClick={onAdd}>
        add locally
      </button>
      {addOpen && (
        <label>
          local setup
          <input />
        </label>
      )}
    </section>
  ),
}));

vi.mock('./SkillList/LobeHub', () => ({
  default: () => <div data-testid="lobehub-list" />,
}));

vi.mock('./SkillList/MarketSkills', () => ({
  default: () => <div data-testid="skill-list" />,
}));

vi.mock('./SkillList/MCP', () => ({
  default: () => <div data-testid="mcp-list" />,
}));

afterEach(() => {
  cleanup();
  env.isDesktop = true;
  delete process.env.NEXT_PUBLIC_MASTERLION_OFFLINE_MODE;
});

describe('SkillStoreContent', () => {
  it('hides the LobeHub market tab and list in Masterino offline mode', () => {
    process.env.NEXT_PUBLIC_MASTERLION_OFFLINE_MODE = '1';

    render(<SkillStoreContent />);

    expect(screen.queryByText('skillStore.tabs.lobehub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lobehub-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('segmented')).toHaveAttribute('data-value', 'skills');
    expect(screen.getByTestId('skill-list')).toBeInTheDocument();
  });

  it('keeps the LobeHub market tab available when offline mode is disabled', () => {
    render(<SkillStoreContent />);

    expect(screen.getByText('skillStore.tabs.lobehub')).toBeInTheDocument();
    expect(screen.getByTestId('lobehub-list')).toBeInTheDocument();
    expect(screen.getByTestId('segmented')).toHaveAttribute('data-value', 'lobehub');
  });

  it('opens server MCP by default and expands local setup inside the same content', () => {
    render(<SkillStoreContent />);
    fireEvent.click(screen.getByRole('button', { name: 'skillStore.tabs.mcp' }));
    expect(screen.getByTestId('mcp-list')).toBeVisible();
    expect(screen.queryByLabelText('local setup')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'deviceLocalMcp.localTab' }));
    expect(screen.getByTestId('mcp-list')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'add locally' }));
    expect(screen.getByLabelText('local setup')).toBeVisible();
  });

  it('keeps local MCP navigation desktop-only', () => {
    env.isDesktop = false;
    render(<SkillStoreContent openLocal />);
    fireEvent.click(screen.getByRole('button', { name: 'skillStore.tabs.mcp' }));
    expect(screen.getByTestId('mcp-list')).toBeVisible();
    expect(screen.queryByText('deviceLocalMcp.localTab')).toBeNull();
  });

  it('reuses the open store when chat starts local setup', () => {
    const onClose = vi.fn();
    modal.create.mockReturnValue({ close: vi.fn(), update: modal.update });
    const close = createSkillStoreModal();
    try {
      createSkillStoreModal({ openLocal: true, setup: { onClose } });
      expect(modal.create).toHaveBeenCalledOnce();
      render(modal.update.mock.lastCall?.[0].children);
      expect(screen.getByLabelText('local setup')).toBeVisible();
    } finally {
      close?.();
    }
    expect(onClose).toHaveBeenCalledOnce();
  });
});
