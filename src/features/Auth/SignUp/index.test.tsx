import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SignUp from './index';

const mockServerConfig = vi.hoisted(() => ({
  disableEmailPassword: false,
  disableEmailSignup: false,
}));

vi.mock('@/features/AuthShell', () => ({
  useAuthServerConfigStore: (selector: (state: any) => unknown) =>
    selector({ serverConfig: mockServerConfig }),
}));

vi.mock('./BetterAuthSignUpForm', () => ({
  default: () => <div>signup-form</div>,
}));

const renderSignUp = () =>
  render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route element={<SignUp />} path="/signup" />
        <Route element={<div>signin-page</div>} path="/signin" />
      </Routes>
    </MemoryRouter>,
  );

describe('SignUp', () => {
  beforeEach(() => {
    mockServerConfig.disableEmailPassword = false;
    mockServerConfig.disableEmailSignup = false;
  });

  it('renders the signup form when email signup is enabled', () => {
    renderSignUp();

    expect(screen.getByText('signup-form')).toBeInTheDocument();
  });

  it('redirects to sign in when only email signup is disabled', () => {
    mockServerConfig.disableEmailSignup = true;

    renderSignUp();

    expect(screen.getByText('signin-page')).toBeInTheDocument();
  });

  it('preserves the legacy full email/password disable behavior', () => {
    mockServerConfig.disableEmailPassword = true;

    renderSignUp();

    expect(screen.getByText('signin-page')).toBeInTheDocument();
  });
});
