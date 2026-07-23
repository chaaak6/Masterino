import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillStoreContent } from './SkillStoreContent';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Segmented: ({ options, value }: { options: { label: string; value: string }[]; value: string }) => (
    <div data-testid="segmented" data-value={value}>
      {options.map((option) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
}));

vi.mock('./Search', () => ({
  default: ({ activeTab }: { activeTab: string }) => <div data-testid="search">{activeTab}</div>,
}));

vi.mock('./SkillList/AddSkillButton', () => ({
  default: () => <button type="button">add</button>,
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
});
