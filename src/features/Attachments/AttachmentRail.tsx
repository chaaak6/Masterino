import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  rail: css`
    position: relative;

    display: flex;
    gap: 4px;
    align-items: center;
    align-self: flex-end;

    width: max-content;
    min-width: 0;
    max-width: min(100%, 560px);
  `,
  track: css`
    scrollbar-color: ${cssVar.colorFillSecondary} transparent;
    scrollbar-width: thin;
    scroll-snap-type: x proximity;

    overflow-x: auto;
    overscroll-behavior-x: contain;
    display: flex;
    gap: 8px;

    min-width: 0;
    max-width: 100%;
    padding-block: 3px 5px;
    padding-inline: 1px;
    border-radius: 12px;

    > * {
      scroll-snap-align: start;
      flex: 0 0 auto;
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  previous: css`
    flex-shrink: 0;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 50%;

    background: ${cssVar.colorBgElevated};
    box-shadow: 0 2px 8px ${cssVar.colorFillSecondary};
  `,
  next: css`
    flex-shrink: 0;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 50%;

    background: ${cssVar.colorBgElevated};
    box-shadow: 0 2px 8px ${cssVar.colorFillSecondary};
  `,
}));

/** Native horizontal scrolling leaves vertical wheel/touch gestures with the conversation. */
export default function AttachmentRail({ children }: { children: ReactNode[] }) {
  const { t } = useTranslation('chat');
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  const count = children.length;
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const update = () =>
      setEdges((previous) => {
        const next = {
          previous: node.scrollLeft > 2,
          next: node.scrollLeft + node.clientWidth < node.scrollWidth - 2,
        };
        return previous.previous === next.previous && previous.next === next.next ? previous : next;
      });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    node.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', update);
    };
  }, [count]);
  const scroll = (direction: number) => {
    const node = track.current;
    if (node)
      node.scrollBy({
        left: direction * Math.max(80, node.clientWidth - 80),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
  };
  return (
    <div className={styles.rail} data-message-attachments="">
      {(edges.previous || edges.next) && (
        <Button
          aria-controls={id}
          aria-label={t('attachments.scrollPrevious')}
          className={styles.previous}
          disabled={!edges.previous}
          size="small"
          style={{ borderRadius: '50%', width: 24, height: 24, minWidth: 24, padding: 0 }}
          title={t('attachments.scrollPrevious')}
          onClick={() => scroll(-1)}
        >
          <ChevronLeft aria-hidden size={14} />
        </Button>
      )}
      <div
        aria-label={t('attachments.messageAttachments')}
        className={styles.track}
        id={id}
        ref={track}
        role="group"
        tabIndex={0}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            scroll(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        {children}
      </div>
      {(edges.previous || edges.next) && (
        <Button
          aria-controls={id}
          aria-label={t('attachments.scrollNext')}
          className={styles.next}
          disabled={!edges.next}
          size="small"
          style={{ borderRadius: '50%', width: 24, height: 24, minWidth: 24, padding: 0 }}
          title={t('attachments.scrollNext')}
          onClick={() => scroll(1)}
        >
          <ChevronRight aria-hidden size={14} />
        </Button>
      )}
    </div>
  );
}
