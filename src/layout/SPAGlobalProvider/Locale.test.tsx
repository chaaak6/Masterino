import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Locale from './Locale';

const mocks = vi.hoisted(() => {
  const fakeI18n = {
    init: vi.fn(),
    instance: {
      isInitialized: true,
      language: 'zh-CN',
      off: vi.fn(),
      on: vi.fn(),
    },
  };

  return {
    fakeI18n,
  };
});

vi.mock('antd', () => ({
  ConfigProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="config-provider">{children}</div>
  ),
}));

vi.mock('react-i18next', () => ({
  I18nextProvider: ({ children, i18n }: { children: ReactNode; i18n: { language?: string } }) => (
    <div data-i18n-language={i18n.language} data-testid="i18next-provider">
      {children}
    </div>
  ),
}));

vi.mock('@/layout/GlobalProvider/Editor', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="editor">{children}</div>,
}));

vi.mock('@/locales/create', () => ({
  createI18nNext: vi.fn(() => mocks.fakeI18n),
}));

vi.mock('@/utils/dayjsLocale', () => ({
  loadDayjsLocaleModule: vi.fn(async () => ({ default: 'zh-cn' })),
  normalizeDayjsLocale: vi.fn(() => 'zh-cn'),
}));

vi.mock('@/utils/locale', () => ({
  getAntdLocale: vi.fn(async () => ({})),
}));

describe('SPAGlobalProvider Locale', () => {
  it('provides the initialized i18next instance to react-i18next consumers', () => {
    render(
      <Locale defaultLang="zh-CN">
        <span>localized child</span>
      </Locale>,
    );

    expect(screen.getByTestId('i18next-provider')).toHaveAttribute('data-i18n-language', 'zh-CN');
    expect(screen.getByText('localized child')).toBeInTheDocument();
  });
});
