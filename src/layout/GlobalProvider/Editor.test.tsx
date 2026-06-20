import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Editor from './Editor';

const mocks = vi.hoisted(() => ({
  useTranslation: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: mocks.useTranslation,
}));

vi.mock('@lobehub/editor/react', () => ({
  EditorProvider: ({ children, config }: any) => (
    <div data-locale={JSON.stringify(config?.locale ?? null)} data-testid="editor-provider">
      {children}
    </div>
  ),
}));

describe('GlobalProvider Editor', () => {
  beforeEach(() => {
    mocks.useTranslation.mockReset();
  });

  it('renders when i18next is not initialized yet', () => {
    mocks.useTranslation.mockReturnValue({ i18n: { language: 'zh-CN' } });

    render(
      <Editor>
        <span>editor content</span>
      </Editor>,
    );

    expect(screen.getByText('editor content')).toBeInTheDocument();
    expect(screen.getByTestId('editor-provider')).toHaveAttribute('data-locale', 'null');
  });

  it('passes editor locale when resource bundle is available', () => {
    mocks.useTranslation.mockReturnValue({
      i18n: {
        getResourceBundle: vi.fn(() => ({ placeholder: '请输入内容' })),
        language: 'zh-CN',
      },
    });

    render(
      <Editor>
        <span>editor content</span>
      </Editor>,
    );

    expect(screen.getByTestId('editor-provider')).toHaveAttribute(
      'data-locale',
      JSON.stringify({ placeholder: '请输入内容' }),
    );
  });
});
