import { Button, Icon, InputPassword, Text } from '@lobehub/ui';
import { TypewriterEffect } from '@lobehub/ui/awesome';
import { LoadingDots } from '@lobehub/ui/chat';
import { type FormInstance, type InputRef } from 'antd';
import { Form } from 'antd';
import { cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';

export interface SignInPasswordStepProps {
  email: string;
  form: FormInstance<{ password: string }>;
  loading: boolean;
  onBackToEmail: () => void;
  onForgotPassword: () => Promise<void>;
  onSubmit: (values: { password: string }) => Promise<void>;
}

export const SignInPasswordStep = ({
  email,
  form,
  loading,
  onBackToEmail,
  onForgotPassword,
  onSubmit,
}: SignInPasswordStepProps) => {
  const { i18n, t } = useTranslation('auth');
  const title = t('signin.title');
  const titleKey = `${i18n.resolvedLanguage || i18n.language}-${title}`;
  const passwordInputRef = useRef<InputRef>(null);

  useEffect(() => {
    passwordInputRef.current?.focus();
  }, []);

  return (
    <AuthCard
      subtitle={t('betterAuth.signin.passwordStep.subtitle')}
      title={
        <TypewriterEffect
          cursorCharacter={<LoadingDots size={28} variant={'pulse'} />}
          cursorFade={false}
          hideCursorWhileTyping={'afterTyping'}
          key={titleKey}
          loop={false}
          sentences={[title]}
          textColors={[cssVar.colorText]}
          typingSpeed={64}
        />
      }
      footer={
        <>
          <Text fontSize={13} type={'secondary'}>
            <a
              style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={onForgotPassword}
            >
              {t('betterAuth.signin.forgotPassword')}
            </a>
          </Text>
          <Button
            icon={ChevronLeft}
            size={'large'}
            style={{ marginTop: 16 }}
            onClick={onBackToEmail}
          >
            {t('betterAuth.signin.backToEmail')}
          </Button>
        </>
      }
    >
      <Text fontSize={20}>{email}</Text>
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 12 }}
        onFinish={(values) => onSubmit(values as { password: string })}
      >
        <Form.Item
          name="password"
          rules={[{ message: t('betterAuth.errors.passwordRequired'), required: true }]}
          style={{ marginBottom: 0 }}
        >
          <InputPassword
            placeholder={t('betterAuth.signin.passwordPlaceholder')}
            ref={passwordInputRef}
            size="large"
            prefix={
              <Icon
                icon={Lock}
                style={{
                  marginInline: 6,
                }}
              />
            }
            style={{
              padding: 6,
            }}
            suffix={
              <Button
                icon={ChevronRight}
                loading={loading}
                style={{ color: cssVar.colorPrimary }}
                title={t('betterAuth.signin.submit')}
                variant={'filled'}
                onClick={() => form.submit()}
              />
            }
          />
        </Form.Item>
      </Form>
    </AuthCard>
  );
};
