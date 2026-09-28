import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import en from '@/../locales/en-US/common.json';
import viVN from '@/../locales/vi-VN/common.json';
import zh from '@/../locales/zh-CN/common.json';

import FullscreenLoading from './index';

vi.mock('@/components/InitProgress', () => ({
  default: () => <div data-testid="init-progress">init progress</div>,
}));

describe('FullscreenLoading', () => {
  it.each(['en-US', 'zh-CN', 'vi-VN'])('uses translated loading text for %s', async (locale) => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: locale,
      defaultNS: 'common',
      resources: {
        'en-US': { common: en },
        'zh-CN': { common: zh },
        'vi-VN': { common: viVN },
      },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <FullscreenLoading activeStage={0} stages={[]} />
      </I18nextProvider>,
    );
    expect(screen.getByAltText(i18n.t('loading'))).toHaveAttribute(
      'src',
      `/brand/masterlion/loading-masterlion-${locale === 'zh-CN' ? 'zh' : 'en'}.svg`,
    );
    expect(screen.getByTestId('init-progress')).toBeInTheDocument();
  });
});
