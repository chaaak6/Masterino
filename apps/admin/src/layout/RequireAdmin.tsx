import { Button, Result, Spin } from 'antd';
import type { PropsWithChildren } from 'react';

import adminEnv from '@admin/env';
import { useSession } from '@admin/lib/auth';
import { trpc } from '@admin/lib/trpc';

function getSignInUrl() {
  if (typeof window === 'undefined') {
    return `${adminEnv.apiBaseUrl || ''}/signin`;
  }

  const baseUrl = adminEnv.apiBaseUrl || window.location.origin;
  const url = new URL('/signin', baseUrl);
  url.searchParams.set('callbackUrl', window.location.href);

  return url.toString();
}

export default function RequireAdmin({ children }: PropsWithChildren) {
  const session = useSession();
  const permission = trpc.admin.me.useQuery(undefined, {
    enabled: !!session.data?.user,
  });

  if (session.isPending || permission.isLoading) {
    return <Spin fullscreen />;
  }

  if (!session.data?.user) {
    return (
      <Result
        extra={
          <Button href={getSignInUrl()} type="primary">
            {'\u767b\u5f55'}
          </Button>
        }
        status="403"
        subTitle={'\u8bf7\u5148\u767b\u5f55 Masterion \u540e\u53f0\u3002'}
        title={'\u9700\u8981\u767b\u5f55'}
      />
    );
  }

  if (!permission.data?.isPlatformAdmin) {
    return (
      <Result
        status="403"
        subTitle={'\u5f53\u524d\u8d26\u53f7\u4e0d\u662f\u5e73\u53f0\u7ba1\u7406\u5458\u3002'}
        title={'\u65e0\u540e\u53f0\u6743\u9650'}
      />
    );
  }

  return children;
}
