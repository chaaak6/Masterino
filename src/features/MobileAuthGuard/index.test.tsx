import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import MobileAuthGuard from './index';

const initialUserState = useUserStore.getState();

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: ({ debugId }: { debugId: string }) => <div data-debug-id={debugId}>Loading</div>,
}));

afterEach(() => {
  useUserStore.setState(initialUserState, true);
});

describe('MobileAuthGuard', () => {
  it('redirects to sign in before rendering protected mobile content when logged out', async () => {
    const openLogin = vi.fn();
    useUserStore.setState({ isLoaded: true, isSignedIn: false, openLogin } as any);

    render(
      <MobileAuthGuard>
        <div>Protected mobile content</div>
      </MobileAuthGuard>,
    );

    expect(screen.queryByText('Protected mobile content')).not.toBeInTheDocument();
    expect(screen.getByText('Loading')).toHaveAttribute('data-debug-id', 'MobileAuthGuard');
    await waitFor(() => expect(openLogin).toHaveBeenCalledTimes(1));
  });

  it('renders protected mobile content after the user is logged in', () => {
    useUserStore.setState({ isLoaded: true, isSignedIn: true });

    render(
      <MobileAuthGuard>
        <div>Protected mobile content</div>
      </MobileAuthGuard>,
    );

    expect(screen.getByText('Protected mobile content')).toBeInTheDocument();
  });
});
