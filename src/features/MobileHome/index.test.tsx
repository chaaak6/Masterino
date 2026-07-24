import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MobileHome from './index';

vi.mock('@/routes/(main)/home/_layout/Body/Agent/List', () => ({
  default: () => <div data-testid="pc-agent-list" />,
}));

vi.mock('./MobileAgentList', () => ({
  default: () => <div data-testid="mobile-agent-list" />,
}));

describe('MobileHome', () => {
  it('renders the mobile agent list instead of the desktop sidebar list', () => {
    render(<MobileHome />);

    expect(screen.getByTestId('mobile-agent-list')).toBeInTheDocument();
    expect(screen.queryByTestId('pc-agent-list')).not.toBeInTheDocument();
  });
});
