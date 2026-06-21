'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import GroupIdSync from '@/routes/(main)/group/_layout/GroupIdSync';
import { styles } from '@/routes/(mobile)/chat/_layout/style';

import Header from './Header';

const Layout: FC = () => {
  useInitGroupConfig();

  return (
    <>
      <MobileContentLayout className={styles.mainContainer} header={<Header />}>
        <Outlet />
      </MobileContentLayout>
      <GroupIdSync />
    </>
  );
};

export default Layout;
