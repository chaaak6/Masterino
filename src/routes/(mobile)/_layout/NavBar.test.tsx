import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();

vi.mock('@lobehub/ui/mobile', () => ({
  TabBar: ({ items }: any) => (
    <nav>
      {items.map((item: any) => (
        <button key={item.key} type="button" onClick={item.onClick}>
          {item.title}
        </button>
      ))}
    </nav>
  ),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span data-testid="icon" />,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ active: 'active', container: 'container' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

vi.mock('@/hooks/useActiveTabKey', () => ({
  useActiveTabKey: () => 'community',
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: {},
  useServerConfigStore: () => ({ showMarket: true }),
}));

import NavBar from './NavBar';

describe('mobile NavBar', () => {
  it('shows short community text and routes community plus messages to coming-soon tabs', () => {
    render(<NavBar />);

    expect(screen.getByRole('button', { name: 'tab.community' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tab.message' })).toBeInTheDocument();
    expect(screen.queryByText(/productFeatures\.disabled/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'tab.community' }));
    fireEvent.click(screen.getByRole('button', { name: 'tab.message' }));

    expect(navigate).toHaveBeenCalledWith('/community');
    expect(navigate).toHaveBeenCalledWith('/messages');
  });
});
