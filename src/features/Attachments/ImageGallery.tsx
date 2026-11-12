import { copyImageToClipboard } from '@lobechat/utils/client';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Button, ContextMenuTrigger, DropdownMenu, Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight, ImageOff, Minus, MoreHorizontal, Plus, X } from 'lucide-react';
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { logChatAttachment } from '@/utils/chatAttachments';

export interface GalleryImage {
  allowAddOnPreviewError?: boolean;
  caption?: ReactNode;
  id: string;
  load?: () => Promise<string>;
  local?: boolean;
  name: string;
  onAdd?: (previewUrl?: string) => Promise<boolean>;
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
    overflow-x: auto;
    display: flex;
    gap: 8px;

    width: 100%;
    padding-block: 4px;
    padding-inline: 0;

    > * {
      flex: 0 0 80px;
    }
  `,
  railTile: css`
    flex: 0 0 72px;
    width: 72px;
    height: 72px;

    button {
      aspect-ratio: 1;
      width: 72px;
      height: 72px;
    }

    button img {
      object-fit: contain;
    }
  `,
  tile: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;
    display: block;

    aspect-ratio: 1.35;
    padding: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};

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
      onClick={(event) => {
        if (!event.altKey) onOpen();
      }}
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
  ({
    items,
    compact = false,
    renderThumbnails,
  }: {
    compact?: boolean;
    items: GalleryImage[];
    renderThumbnails?: (thumbnails: ReactNode[]) => ReactNode;
  }) => {
    const { t } = useTranslation(['chat', 'common']);
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
    const previewSession = useRef(0);
    const gesture = useRef<{ x: number; y: number; time: number; pointerId: number } | undefined>(
      undefined,
    );
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    const load = useCallback(
      (item: GalleryImage, refresh = false) => {
        if (!item.load || busy.current.has(item.id)) return;
        if (!refresh && (item.url || sources[item.id] || errors[item.id])) return;
        busy.current.add(item.id);
        if (refresh) setSources((prev) => ({ ...prev, [item.id]: '' }));
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
    useLayoutEffect(() => {
      previewSession.current += 1;
      setZoom(1);
      setDimensions(undefined);
      setAdded(undefined);
      setAdding(false);
    }, [active?.id, revision]);
    const close = () => {
      setAdded(undefined);
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
    const shown = expanded || renderThumbnails ? items : items.slice(0, compact ? 10 : 6);
    const source = active && !errors[active.id] && (sources[active.id] ?? active.url);
    useEffect(() => {
      if (index !== undefined && !items[index]) setIndex(undefined);
    }, [index, items]);
    const imageMenu = (item: GalleryImage, url?: string) => [
      {
        key: 'copy-image',
        label: t('attachments.copyImage'),
        disabled: !item.onCopy && (!url || !!errors[item.id]),
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
    const thumbnails = shown.map((item, i) => (
      <Flexbox
        className={renderThumbnails ? styles.railTile : undefined}
        gap={4}
        key={item.id}
        style={{ position: 'relative', minWidth: 0 }}
      >
        <ContextMenuTrigger
          items={() => imageMenu(item, sources[item.id] ?? item.url)}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <div style={{ display: 'contents' }}>
            <Thumbnail
              item={item}
              load={load}
              source={!errors[item.id] ? (sources[item.id] ?? item.url) : undefined}
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
    ));
    return (
      <Flexbox gap={8} style={{ minWidth: 0, maxWidth: '100%' }}>
        {renderThumbnails ? (
          renderThumbnails(thumbnails)
        ) : (
          <div className={compact ? styles.compact : styles.grid}>{thumbnails}</div>
        )}
        {!renderThumbnails && items.length > shown.length && (
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
              <div
                aria-busy={!source && !errors[active.id]}
                className={styles.canvas}
                style={{
                  touchAction: zoom === 1 ? 'pan-y pinch-zoom' : 'none',
                  cursor: zoom > 1 ? 'grab' : undefined,
                }}
                onPointerCancel={() => {
                  gesture.current = undefined;
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
                  if (!event.isPrimary) {
                    gesture.current = undefined;
                    return;
                  }
                  gesture.current = {
                    x: event.clientX,
                    y: event.clientY,
                    time: performance.now(),
                    pointerId: event.pointerId,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const start = gesture.current;
                  if (!start || start.pointerId !== event.pointerId || zoom === 1) return;
                  event.currentTarget.scrollLeft += start.x - event.clientX;
                  event.currentTarget.scrollTop += start.y - event.clientY;
                  start.x = event.clientX;
                  start.y = event.clientY;
                }}
                onPointerUp={(event) => {
                  const start = gesture.current;
                  gesture.current = undefined;
                  if (!start || start.pointerId !== event.pointerId || zoom !== 1) return;
                  const x = event.clientX - start.x;
                  const y = event.clientY - start.y;
                  if (
                    Math.abs(x) >= 48 &&
                    Math.abs(x) > Math.abs(y) * 1.5 &&
                    performance.now() - start.time < 1000
                  ) {
                    const next = Math.max(
                      0,
                      Math.min(items.length - 1, (index ?? 0) + (x < 0 ? 1 : -1)),
                    );
                    if (next !== index)
                      logChatAttachment('image-preview-navigated', {
                        id: items[next].id,
                        reason: 'swipe',
                      });
                    setIndex(next);
                  }
                }}
              >
                {source ? (
                  <ContextMenuTrigger
                    items={() => imageMenu(active, source)}
                    onContextMenu={(event) => event.stopPropagation()}
                  >
                    <img
                      alt={active.name}
                      className={styles.image}
                      draggable={false}
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
                        setDimensions({ width: image.clientWidth, height: image.clientHeight });
                      }}
                    />
                  </ContextMenuTrigger>
                ) : (
                  <Text role={errors[active.id] ? 'alert' : 'status'}>
                    {errors[active.id]
                      ? t(
                          active.local
                            ? 'attachments.localPreviewUnavailable'
                            : 'attachments.previewUnavailable',
                        )
                      : active.local
                        ? t('localAttachment.checking')
                        : t('loading', { ns: 'common' })}
                  </Text>
                )}
                {errors[active.id] && (
                  <Button
                    size="small"
                    onClick={() => {
                      setErrors((prev) => ({ ...prev, [active.id]: false }));
                      load(active, true);
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
                <DropdownMenu items={imageMenu(active, source || undefined)}>
                  <ActionIcon
                    aria-label={t('attachments.imageActions')}
                    icon={MoreHorizontal}
                    title={t('attachments.imageActions')}
                  />
                </DropdownMenu>
                {active.onAdd && (
                  <Button
                    disabled={
                      adding ||
                      ((!source || !!errors[active.id]) &&
                        !(active.allowAddOnPreviewError && errors[active.id]))
                    }
                    loading={adding}
                    size="small"
                    onClick={async () => {
                      const session = previewSession.current;
                      setAdding(true);
                      try {
                        if (
                          (await active.onAdd?.(
                            errors[active.id] ? undefined : source || undefined,
                          )) &&
                          previewSession.current === session
                        )
                          setAdded(active.id);
                      } catch {
                        if (previewSession.current === session)
                          setErrors((prev) => ({ ...prev, [active.id]: true }));
                      } finally {
                        if (previewSession.current === session) setAdding(false);
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
