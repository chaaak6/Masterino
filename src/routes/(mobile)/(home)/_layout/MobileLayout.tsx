import { type PropsWithChildren } from 'react';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { AgentModalProvider } from '@/routes/(main)/home/_layout/Body/Agent/ModalProvider';

import SessionHeader from './SessionHeader';

const MobileLayout = ({ children }: PropsWithChildren) => {
  return (
    <AgentModalProvider>
      <MobileContentLayout withNav header={<SessionHeader />}>{children}</MobileContentLayout>
    </AgentModalProvider>
  );
};

export default MobileLayout;
