import { type IconProps } from '@lobehub/ui';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { type KeyboardEvent, type ReactNode } from 'react';
import { memo } from 'react';

import Divider from './Divider';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
    border-radius: 0;
    font-size: 15px;

    &:not([aria-disabled='true']):active {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  disabled: css`
    cursor: not-allowed;
    opacity: 0.55;
  `,
  right: css`
    min-width: 0;
  `,
}));

export interface CellProps {
  disabled?: boolean;
  extra?: ReactNode;
  icon?: IconProps['icon'];
  key?: string | number;
  label?: string | ReactNode;
  onClick?: () => void;
  showChevron?: boolean;
  type?: 'divider';
}

const Cell = memo<CellProps>(
  ({ label, icon, onClick, type, disabled = false, extra, showChevron = !disabled }) => {
    if (type === 'divider') return <Divider />;

    const clickable = Boolean(onClick) || disabled;
    const handleClick = () => {
      if (disabled) return;
      onClick?.();
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (!clickable || disabled) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick?.();
      }
    };

    return (
      <Flexbox
        horizontal
        align={'center'}
        aria-disabled={disabled || undefined}
        className={cx(styles.container, disabled && styles.disabled)}
        gap={12}
        justify={'space-between'}
        padding={16}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable && !disabled ? 0 : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <Flexbox horizontal align={'center'} gap={12}>
          {icon && <Icon color={cssVar.colorPrimaryBorder} icon={icon} size={{ size: 20 }} />}
          {label}
        </Flexbox>
        <Flexbox horizontal align={'center'} className={styles.right} flex={'none'} gap={8}>
          {extra && (
            <Text ellipsis fontSize={13} type={'secondary'}>
              {extra}
            </Text>
          )}
          {showChevron && (
            <Icon color={cssVar.colorBorder} icon={ChevronRight} size={{ size: 16 }} />
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default Cell;
