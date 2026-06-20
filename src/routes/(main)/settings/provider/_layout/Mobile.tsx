'use client';

import { type PropsWithChildren } from 'react';

interface LayoutProps extends PropsWithChildren {
  onProviderSelect: (providerKey: string) => void;
}

const Layout = ({ children, onProviderSelect: _onProviderSelect }: LayoutProps) => {
  return children;
};

export default Layout;
