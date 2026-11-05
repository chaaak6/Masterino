import { ActionIcon, Button, Flexbox, Text } from '@lobehub/ui';
import { Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus, X } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface GalleryImage {
  caption?: ReactNode;
  id: string;
  load?: () => Promise<string>;
  name: string;
  onAdd?: () => Promise<boolean>;
  onRemove?: () => void;
  url?: string;
}
const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 6px;
    width: min(100%, 480px);
  `,
  compact: css`
    display: flex;
    overflow-x: auto;
    gap: 8px;
    width: 100%;
    padding: 4px 0;
    > * {
      flex: 0 0 80px;
    }
  `,
  tile: css`
    overflow: hidden;
    position: relative;
    aspect-ratio: 1.35;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorFillQuaternary};
    color: ${cssVar.colorTextSecondary};
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
  image: css`
    display: block;
    max-width: 100%;
    max-height: 65vh;
    margin: auto;
    object-fit: contain;
    transform-origin: center;
  `,
  canvas: css`
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 240px;
    max-height: 68vh;
  `,
}));

function Thumbnail({
  item,
  load,
  onOpen,
  source,
}: {
  item: GalleryImage;
  load: (item: GalleryImage) => void;
  onOpen: () => void;
  source?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        load(item);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [item, load]);
  return (
    <button
      aria-label={item.name}
      className={styles.tile}
      disabled={!source && !item.load}
      ref={ref}
      title={item.name}
      type="button"
      onClick={onOpen}
    >
      {source ? (
        <img alt={item.name} loading="lazy" src={source} />
      ) : (
        <ImageOff aria-hidden size={24} />
      )}
    </button>
  );
}

const ImageGallery = memo(
  ({ items, compact = false }: { compact?: boolean; items: GalleryImage[] }) => {
    const { t } = useTranslation('chat');
    const [sources, setSources] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, boolean>>({});
    const busy = useRef(new Set<string>());
    const mounted = useRef(true);
    const trigger = useRef<HTMLElement | null>(null);
    const [index, setIndex] = useState<number>();
    const [expanded, setExpanded] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [adding, setAdding] = useState(false);
    const [added, setAdded] = useState<string>();
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    const load = useCallback(
      (item: GalleryImage) => {
        if (
          item.url ||
          sources[item.id] ||
          errors[item.id] ||
          busy.current.has(item.id) ||
          !item.load
        )
          return;
        busy.current.add(item.id);
        void item
          .load()
          .then((url) => {
            if (mounted.current) setSources((prev) => ({ ...prev, [item.id]: url }));
          })
          .catch(() => {
            if (mounted.current) setErrors((prev) => ({ ...prev, [item.id]: true }));
          })
          .finally(() => busy.current.delete(item.id));
      },
      [sources, errors],
    );
    const active = index === undefined ? undefined : items[index];
    useEffect(() => {
      if (active) load(active);
    }, [active, load]);
    useEffect(() => {
      setZoom(1);
    }, [index]);
    const close = () => {
      setIndex(undefined);
      requestAnimationFrame(() => trigger.current?.focus());
    };
    useEffect(() => {
      if (index === undefined) return;
      const key = (event: KeyboardEvent) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setIndex((i) => Math.max(0, (i ?? 0) - 1));
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          setIndex((i) => Math.min(items.length - 1, (i ?? 0) + 1));
        }
      };
      window.addEventListener('keydown', key);
      return () => window.removeEventListener('keydown', key);
    }, [index, items.length]);
    const shown = expanded ? items : items.slice(0, compact ? 10 : 6);
    const source = active && (active.url || sources[active.id]);
    return (
      <Flexbox gap={8}>
        <div
          className={compact ? styles.compact : styles.grid}
          style={
            compact ? { gridTemplateColumns: 'repeat(auto-fill, 80px)', width: '100%' } : undefined
          }
        >
          {shown.map((item, i) => (
            <Flexbox gap={4} key={item.id} style={{ position: 'relative', minWidth: 0 }}>
              <Thumbnail
                item={item}
                load={load}
                source={item.url || sources[item.id]}
                onOpen={() => {
                  trigger.current = document.activeElement as HTMLElement;
                  setIndex(i);
                }}
              />
              {item.onRemove && (
                <ActionIcon
                  aria-label={t('attachments.remove', { name: item.name })}
                  icon={X}
                  size="small"
                  title={t('attachments.remove', { name: item.name })}
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    background: 'var(--color-bg-elevated)',
                  }}
                  onClick={item.onRemove}
                />
              )}
              {item.caption}
            </Flexbox>
          ))}
        </div>
        {items.length > shown.length && (
          <Button size="small" onClick={() => setExpanded(true)}>
            {t('attachments.showAll', { count: items.length })}
          </Button>
        )}
        <Modal
          destroyOnHidden
          footer={null}
          open={index !== undefined}
          title={active ? `${(index ?? 0) + 1}/${items.length} · ${active.name}` : ''}
          width="min(95vw, 1000px)"
          onCancel={close}
        >
          {active && (
            <Flexbox gap={12}>
              <div aria-busy={!source && !errors[active.id]} className={styles.canvas}>
                {source ? (
                  <img
                    alt={active.name}
                    className={styles.image}
                    src={source}
                    style={{ transform: `scale(${zoom})` }}
                  />
                ) : (
                  <Text role={errors[active.id] ? 'alert' : 'status'}>
                    {t(
                      errors[active.id]
                        ? 'localAttachment.unavailable'
                        : 'localAttachment.checking',
                    )}
                  </Text>
                )}
              </div>
              <Flexbox horizontal align="center" gap={8} justify="center">
                <ActionIcon
                  aria-label={t('attachments.previous')}
                  disabled={index === 0}
                  icon={ChevronLeft}
                  title={t('attachments.previous')}
                  onClick={() => setIndex((i) => Math.max(0, (i ?? 0) - 1))}
                />
                <Text aria-live="polite">
                  {(index ?? 0) + 1}/{items.length}
                </Text>
                <ActionIcon
                  aria-label={t('attachments.next')}
                  disabled={index === items.length - 1}
                  icon={ChevronRight}
                  title={t('attachments.next')}
                  onClick={() => setIndex((i) => Math.min(items.length - 1, (i ?? 0) + 1))}
                />
                <ActionIcon
                  aria-label={t('attachments.zoomOut')}
                  disabled={zoom <= 1}
                  icon={Minus}
                  title={t('attachments.zoomOut')}
                  onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
                />
                <ActionIcon
                  aria-label={t('attachments.zoomIn')}
                  disabled={!source || zoom >= 3}
                  icon={Plus}
                  title={t('attachments.zoomIn')}
                  onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
                />
                {active.onAdd && (
                  <Button
                    disabled={adding}
                    loading={adding}
                    size="small"
                    onClick={async () => {
                      setAdding(true);
                      try {
                        if (await active.onAdd?.()) setAdded(active.id);
                      } finally {
                        setAdding(false);
                      }
                    }}
                  >
                    {t(
                      added === active.id ? 'localAttachment.added' : 'localAttachment.addToInput',
                    )}
                  </Button>
                )}
              </Flexbox>
            </Flexbox>
          )}
        </Modal>
      </Flexbox>
    );
  },
);
export default ImageGallery;
