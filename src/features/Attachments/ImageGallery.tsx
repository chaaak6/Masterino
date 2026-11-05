import { copyImageToClipboard } from '@lobechat/utils/client';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Button, ContextMenuTrigger, Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus, X } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { logChatAttachment } from '@/utils/chatAttachments';

export interface GalleryImage {
  caption?: ReactNode;
  id: string;
  load?: () => Promise<string>;
  name: string;
  onAdd?: () => Promise<boolean>;
  onCopy?: () => Promise<void>;
  onRemove?: () => void;
  onReveal?: () => Promise<void>;
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
  `,
  canvas: css`
    overflow: auto;
    width: 100%;
    min-height: 240px;
    max-height: 68vh;
  `,
}));

function Thumbnail({
  item,
  load,
  onOpen,
  source,
  onError,
}: {
  item: GalleryImage;
  load: (item: GalleryImage) => void;
  onOpen: () => void;
  source?: string;
  onError: () => void;
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
      disabled={!source && !item.load && !item.url}
      ref={ref}
      title={item.name}
      type="button"
      onClick={onOpen}
    >
      {source ? (
        <img alt={item.name} loading="lazy" src={source} onError={onError} />
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
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
    const [revision, setRevision] = useState(0);
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
      setDimensions(undefined);
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
      // Modal primitives can stop bubbling arrow keys; capture while this gallery is open.
      window.addEventListener('keydown', key, true);
      return () => window.removeEventListener('keydown', key, true);
    }, [index, items.length]);
    const shown = expanded ? items : items.slice(0, compact ? 10 : 6);
    const source = active && !errors[active.id] && (active.url || sources[active.id]);
    useEffect(() => {
      if (index !== undefined && !items[index]) setIndex(undefined);
    }, [index, items]);
    const imageMenu = (item: GalleryImage, url?: string) => [
      {
        key: 'copy-image',
        label: t('attachments.copyImage'),
        disabled: !url || !!errors[item.id],
        onClick: async () => {
          try {
            if (item.onCopy) await item.onCopy();
            else if (url) await copyImageToClipboard(url);
            else throw new Error('Image unavailable');
            message.success(t('attachments.imageCopied'));
            logChatAttachment('image-copied', { id: item.id });
          } catch {
            message.error(t('attachments.copyImageFailed'));
            logChatAttachment('image-action-failed', { id: item.id, reason: 'copy' });
          }
        },
      },
      ...(item.onReveal
        ? [
            {
              key: 'reveal-image',
              label: t(
                /Macintosh|Mac OS X/.test(navigator.userAgent)
                  ? 'attachments.revealInFinder'
                  : 'attachments.revealInFolder',
              ),
              onClick: async () => {
                try {
                  await item.onReveal!();
                } catch {
                  message.error(t('attachments.revealImageFailed'));
                  logChatAttachment('image-action-failed', { id: item.id, reason: 'reveal' });
                }
              },
            },
          ]
        : []),
    ];
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
              <ContextMenuTrigger
                items={() => imageMenu(item, item.url || sources[item.id])}
                onContextMenu={(event) => event.stopPropagation()}
              >
                <div style={{ display: 'contents' }}>
                  <Thumbnail
                    item={item}
                    load={load}
                    source={!errors[item.id] ? item.url || sources[item.id] : undefined}
                    onError={() => setErrors((prev) => ({ ...prev, [item.id]: true }))}
                    onOpen={() => {
                      trigger.current = document.activeElement as HTMLElement;
                      setIndex(i);
                    }}
                  />
                </div>
              </ContextMenuTrigger>
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
                  <ContextMenuTrigger
                    items={() => imageMenu(active, source)}
                    onContextMenu={(event) => event.stopPropagation()}
                  >
                    <img
                      alt={active.name}
                      className={styles.image}
                      key={`${active.id}:${revision}`}
                      src={source}
                      style={
                        dimensions
                          ? {
                              width: dimensions.width * zoom,
                              height: dimensions.height * zoom,
                              maxWidth: 'none',
                              maxHeight: 'none',
                            }
                          : undefined
                      }
                      onError={() => setErrors((prev) => ({ ...prev, [active.id]: true }))}
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        setDimensions(
                          (prev) =>
                            prev || { width: image.clientWidth, height: image.clientHeight },
                        );
                      }}
                    />
                  </ContextMenuTrigger>
                ) : (
                  <Text role={errors[active.id] ? 'alert' : 'status'}>
                    {t(
                      errors[active.id]
                        ? active.load
                          ? 'attachments.localPreviewUnavailable'
                          : 'attachments.previewUnavailable'
                        : 'localAttachment.checking',
                    )}
                  </Text>
                )}
                {errors[active.id] && (
                  <Button
                    size="small"
                    onClick={() => {
                      setErrors((prev) => ({ ...prev, [active.id]: false }));
                      setSources((prev) => {
                        const next = { ...prev };
                        delete next[active.id];
                        return next;
                      });
                      setRevision((value) => value + 1);
                    }}
                  >
                    {t('attachments.retry')}
                  </Button>
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
                    disabled={adding || !source || !!errors[active.id]}
                    loading={adding}
                    size="small"
                    onClick={async () => {
                      setAdding(true);
                      try {
                        if (await active.onAdd?.()) setAdded(active.id);
                      } catch {
                        setErrors((prev) => ({ ...prev, [active.id]: true }));
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
