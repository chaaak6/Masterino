'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import HeaderTitle from './HeaderTitle';

const Header = memo(() => {
  const router = useQueryRoute();

  return (
    <ChatHeader
      showBackButton
      center={<HeaderTitle />}
      style={mobileHeaderSticky}
      onBackClick={() => router.push('/agent', { replace: true })}
    />
  );
});

Header.displayName = 'MobileGroupChatHeader';

export default Header;
