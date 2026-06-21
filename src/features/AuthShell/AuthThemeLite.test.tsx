import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui', () => ({
  ConfigProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="config-provider">{children}</div>
  ),
  ThemeProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="theme-provider">{children}</div>
  ),
}));

vi.mock('antd', () => ({
  App: ({ children }: { children: ReactNode }) => <div data-testid="antd-app">{children}</div>,
}));

vi.mock('motion/react', () => ({
  LazyMotion: ({ children }: { children: ReactNode }) => (
    <div data-testid="lazy-motion">{children}</div>
  ),
  domMax: {},
}));

vi.mock('motion/react-m', () => ({}));

vi.mock('@/components/AntdStaticMethods', () => ({
  default: () => null,
}));

vi.mock('@/hooks/useIsDark', () => ({
  useIsDark: () => false,
}));

vi.mock('@/libs/next/Image', () => ({
  default: 'img',
}));

vi.mock('@/libs/next/Link', () => ({
  default: 'a',
}));

import AuthThemeLite from './AuthThemeLite';

describe('AuthThemeLite', () => {
  it('wraps auth content in LazyMotion so motion-based UI can animate', () => {
    render(
      <AuthThemeLite>
        <span>auth content</span>
      </AuthThemeLite>,
    );

    expect(screen.getByTestId('lazy-motion')).toContainElement(screen.getByText('auth content'));
  });
});
