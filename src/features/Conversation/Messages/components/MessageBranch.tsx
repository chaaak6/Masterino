import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';

import { useConversationStore } from '../../store';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 4px;

    background: transparent;
    color: ${cssVar.colorTextSecondary};

    transition: all 0.2s ease;

    &:hover:not(.${prefixCls}-disabled) {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &.${prefixCls}-disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }
  `,
  container: css`
    user-select: none;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    height: 20px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadiusSM};
  `,
  text: css`
    min-width: 24px;
    height: 20px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
}));

interface MessageBranchProps {
  activeBranchIndex: number;
  count: number;
  messageId: string;
}

const MessageBranch = memo<MessageBranchProps>(({ activeBranchIndex, count, messageId }) => {
  const switchMessageBranch = useConversationStore((s) => s.switchMessageBranch);
  const [switching, setSwitching] = useState(false);

  const select = async (index: number) => {
    setSwitching(true);
    try {
      await switchMessageBranch(messageId, index);
    } catch (error) {
      console.error('Failed to switch message branch', error);
    } finally {
      setSwitching(false);
    }
  };

  const canGoPrevious = !switching && activeBranchIndex > 0;
  const canGoNext = !switching && activeBranchIndex < count - 1;

  return (
    <Flexbox horizontal className={styles.container}>
      <button
        aria-label={`${Math.max(1, activeBranchIndex)}/${count}`}
        className={cx(styles.button, !canGoPrevious && `${prefixCls}-disabled`)}
        disabled={!canGoPrevious}
        type="button"
        onClick={() => void select(activeBranchIndex - 1)}
      >
        <Icon icon={ChevronLeft} size={16} />
      </button>
      <Center className={styles.text}>
        {activeBranchIndex + 1}/{count}
      </Center>
      <button
        aria-label={`${Math.min(count, activeBranchIndex + 2)}/${count}`}
        className={cx(styles.button, !canGoNext && `${prefixCls}-disabled`)}
        disabled={!canGoNext}
        type="button"
        onClick={() => void select(activeBranchIndex + 1)}
      >
        <Icon icon={ChevronRight} size={16} />
      </button>
    </Flexbox>
  );
});

export default MessageBranch;
