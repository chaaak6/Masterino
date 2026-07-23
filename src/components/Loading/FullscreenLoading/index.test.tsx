import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FullscreenLoading from './index';

vi.mock('@/components/Branding', () => ({
  ProductLogo: () => <div data-testid="product-logo">LOBEHUB</div>,
}));

vi.mock('@/components/InitProgress', () => ({
  default: () => <div data-testid="init-progress">init progress</div>,
}));

describe('FullscreenLoading', () => {
  it('uses the Masterino handwriting loading animation instead of ProductLogo', () => {
    render(<FullscreenLoading activeStage={0} stages={[]} />);

    expect(screen.queryByTestId('product-logo')).not.toBeInTheDocument();
    expect(screen.getByAltText('小宗狮 loading')).toHaveAttribute(
      'src',
      '/brand/masterlion/loading-masterlion-zh.svg',
    );
    expect(screen.getByTestId('init-progress')).toBeInTheDocument();
  });
});
