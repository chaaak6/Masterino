import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ErrorCapture from './index';

vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  ),
  Block: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FluentEmoji: () => null,
  Highlighter: ({ children }: { children: ReactNode }) => <pre>{children}</pre>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('ErrorCapture', () => {
  it('removes the boot loading screen when rendering the error fallback', () => {
    document.body.innerHTML = '<div id="loading-screen">LobeHub</div>';

    render(<ErrorCapture error={new Error('boot failed')} />);

    expect(document.getElementById('loading-screen')).toBeNull();
  });

  it('shows readable fallback copy when error translations are not ready', () => {
    render(<ErrorCapture error={new Error('boot failed')} />);

    expect(screen.getByRole('heading', { level: 2, name: '页面暂时不可用' })).toBeInTheDocument();
    expect(
      screen.getByText('抱歉，页面遇到了一些问题。请刷新页面或返回首页重试。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '错误堆栈' })).toBeInTheDocument();
  });
});
