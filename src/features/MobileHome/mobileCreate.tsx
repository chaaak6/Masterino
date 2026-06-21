'use client';

import { Flexbox, type MenuProps } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ReactNode } from 'react';

export const MOBILE_CREATE_COMING_SOON_KEY = 'mobileCreate.comingSoon';

type MenuItemType = NonNullable<MenuProps['items']>[number];

const styles = createStaticStyles(({ css, cssVar }) => ({
  comingSoon: css`
    flex: none;
    color: ${cssVar.colorTextDescription};
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
  `,
  label: css`
    min-inline-size: 144px;
  `,
  labelText: css`
    overflow: hidden;
    min-inline-size: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface MenuClickInfo {
  domEvent?: {
    stopPropagation?: () => void;
  };
}

export const MobileCreateComingSoonLabel = ({
  label,
  comingSoon,
}: {
  comingSoon: string;
  label: ReactNode;
}) => (
  <Flexbox horizontal align={'center'} className={styles.label} gap={16} justify={'space-between'}>
    <span className={styles.labelText}>{label}</span>
    <span className={styles.comingSoon}>{comingSoon}</span>
  </Flexbox>
);

export const disableMobileCreateItem = <T extends MenuItemType>(
  item: T,
  comingSoon: string,
): T =>
  ({
    ...item,
    disabled: true,
    label: <MobileCreateComingSoonLabel comingSoon={comingSoon} label={(item as any).label} />,
    onClick: (info?: MenuClickInfo) => {
      info?.domEvent?.stopPropagation?.();
    },
    title: comingSoon,
  }) as T;
