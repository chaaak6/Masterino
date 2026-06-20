import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UserPanel from '../UserPanel';

vi.mock('../UserPanel/PanelContent', () => ({
  default: () => <div>panel content</div>,
}));

vi.mock('../UserPanel/PanelContentSkeleton', () => ({
  default: () => <div>panel loading</div>,
}));

vi.mock('../UserPanel/useNewVersion', () => ({
  useNewVersion: vi.fn(() => true),
}));

describe('UserPanel', () => {
  it('does not show a new badge beside the home header user trigger', () => {
    render(
      <UserPanel>
        <button type="button">陈灿</button>
      </UserPanel>,
    );

    expect(screen.getByRole('button', { name: '陈灿' })).toBeInTheDocument();
    expect(screen.queryByText('new')).not.toBeInTheDocument();
  });
});
