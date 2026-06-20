import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dynamicCallIndex: 0,
}));

vi.mock('@/libs/next/dynamic', () => ({
  default: () => {
    const testId = mocks.dynamicCallIndex === 0 ? 'aihub-detail' : 'provider-grid';
    mocks.dynamicCallIndex += 1;

    return function DynamicComponent() {
      return <div data-testid={testId} />;
    };
  },
}));

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: () => <div data-testid="loading" />,
}));

describe('ProviderDetailPage', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.dynamicCallIndex = 0;
  });

  it('renders Aihub binding detail for the provider entry route', async () => {
    const { default: ProviderDetailPage } = await import('./index');

    render(<ProviderDetailPage id="all" onProviderSelect={vi.fn()} />);

    expect(screen.getByTestId('aihub-detail')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-grid')).not.toBeInTheDocument();
  });
});
