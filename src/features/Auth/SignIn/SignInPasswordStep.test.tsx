import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const translationState = vi.hoisted(() => ({
  language: 'zh-CN',
  title: '同 Agent 团队一起无限进步',
}));

vi.mock('@/features/AuthCard', () => ({
  default: ({ children, footer, subtitle, title }: any) => (
    <section>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
      <footer>{footer}</footer>
    </section>
  ),
}));

vi.mock('@lobehub/ui', async () => {
  const React = await import('react');

  return {
    Button: ({ children, onClick, title }: any) => (
      <button title={title} type="button" onClick={onClick}>
        {children || title}
      </button>
    ),
    Icon: () => <span data-testid="icon" />,
    InputPassword: React.forwardRef(({ placeholder }: any, ref) => {
      React.useImperativeHandle(ref, () => ({ focus: vi.fn() }));

      return <input placeholder={placeholder} type="password" />;
    }),
    Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  };
});

vi.mock('@lobehub/ui/awesome', async () => {
  const React = await import('react');

  return {
    TypewriterEffect: ({
      sentences,
      textColors,
    }: {
      sentences: string[];
      textColors?: string[];
    }) => {
      const [text] = React.useState(sentences[0]);

      return (
        <span data-text-colors={textColors?.join(',')} data-testid="password-title-typewriter">
          {text}
        </span>
      );
    },
  };
});

vi.mock('@lobehub/ui/chat', () => ({
  LoadingDots: () => <span data-testid="loading-dots" />,
}));

vi.mock('antd', () => {
  const Form = ({ children }: { children: ReactNode }) => <form>{children}</form>;
  Form.Item = ({ children }: { children: ReactNode }) => <>{children}</>;

  return { Form };
});

vi.mock('antd-style', () => ({
  cssVar: {
    colorText: 'var(--color-text)',
    colorPrimary: '#1677ff',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: translationState.language,
      resolvedLanguage: translationState.language,
    },
    t: (key: string) =>
      ({
        'betterAuth.signin.backToEmail': '返回修改邮箱',
        'betterAuth.signin.forgotPassword': '忘记密码？',
        'betterAuth.signin.passwordPlaceholder': '请输入密码',
        'betterAuth.signin.passwordStep.subtitle': '请输入密码继续',
        'betterAuth.signin.submit': '登录',
        'signin.title': translationState.title,
      })[key] || key,
  }),
}));

import { SignInPasswordStep } from './SignInPasswordStep';

describe('SignInPasswordStep', () => {
  beforeEach(() => {
    translationState.language = 'zh-CN';
    translationState.title = '同 Agent 团队一起无限进步';
  });

  const props = {
    email: 'user@example.com',
    form: { submit: vi.fn() } as any,
    loading: false,
    onBackToEmail: vi.fn(),
    onForgotPassword: vi.fn(),
    onSubmit: vi.fn(),
  };

  it('keeps the typewriter effect while using the current locale for the password-step title', () => {
    render(<SignInPasswordStep {...props} />);

    const title = screen.getByTestId('password-title-typewriter');

    expect(title).toHaveTextContent('同 Agent 团队一起无限进步');
    expect(title).toHaveAttribute('data-text-colors', 'var(--color-text)');
    expect(screen.getByRole('heading', { name: '同 Agent 团队一起无限进步' })).toBeInTheDocument();
    expect(screen.queryByText('Agent teammates that grow with you')).not.toBeInTheDocument();
  });

  it('restarts the typewriter when the localized title replaces the fallback title', () => {
    translationState.title = 'Agent teammates that grow with you';
    const view = render(<SignInPasswordStep {...props} />);

    expect(screen.getByTestId('password-title-typewriter')).toHaveTextContent(
      'Agent teammates that grow with you',
    );

    translationState.title = '同 Agent 团队一起无限进步';
    view.rerender(<SignInPasswordStep {...props} />);

    expect(screen.getByTestId('password-title-typewriter')).toHaveTextContent(
      '同 Agent 团队一起无限进步',
    );
  });
});
