'use client';

import { Navigate } from 'react-router-dom';

import { useAuthServerConfigStore } from '@/features/AuthShell';

import BetterAuthSignUpForm from './BetterAuthSignUpForm';

const SignUp = () => {
  const disableEmailSignup = useAuthServerConfigStore(
    (s) => s.serverConfig.disableEmailSignup || s.serverConfig.disableEmailPassword || false,
  );

  if (disableEmailSignup) return <Navigate replace to="/signin" />;

  return <BetterAuthSignUpForm />;
};

export default SignUp;
