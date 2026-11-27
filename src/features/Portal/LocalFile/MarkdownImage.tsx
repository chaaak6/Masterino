import { Image } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { ComponentProps } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { localFileKeys } from '@/libs/swr/keys';
import { type LocalFilePreview, projectFileService } from '@/services/projectFile';

import { resolveMarkdownRelativeAssetPath } from './Body.helpers';

interface MarkdownImageProps extends ComponentProps<'img'> {
  deviceId?: string;
  inline?: boolean;
  markdownFilePath: string;
  node?: unknown;
  workingDirectory: string;
}

const dimension = (value: number | string | undefined) => {
  if (typeof value === 'number') return value > 0 && value <= 4096 ? value : undefined;
  if (!value || !/^\d+(?:\.\d+)?(?:%|px)?$/.test(value)) return;
  const size = Number.parseFloat(value);
  if (size <= 0) return;
  if (value.endsWith('%')) return Math.min(size, 100) + '%';
  if (size <= 4096) return size;
};

const MarkdownImage = memo<MarkdownImageProps>(
  ({
    alt,
    className,
    deviceId,
    height,
    inline,
    markdownFilePath,
    src,
    style,
    title,
    width,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');
    const markdownSrc = typeof src === 'string' ? src : undefined;
    const resolvedPath = useMemo(
      () =>
        resolveMarkdownRelativeAssetPath({ markdownFilePath, src: markdownSrc, workingDirectory }),
      [markdownFilePath, markdownSrc, workingDirectory],
    );

    const { data: preview, error } = useClientDataSWR<LocalFilePreview>(
      resolvedPath
        ? localFileKeys.preview({
            accept: 'image',
            deviceId,
            filePath: resolvedPath,
            workingDirectory,
            workspaceOnly: true,
          })
        : null,
      () =>
        projectFileService.getLocalFilePreview({
          accept: 'image',
          deviceId,
          path: resolvedPath!,
          workingDirectory,
          workspaceOnly: true,
        }),
      { revalidateOnFocus: false },
    );

    const blob = resolvedPath && preview?.type === 'image' ? preview.blob : undefined;
    const [loaded, setLoaded] = useState<{ blob: Blob; url: string }>();
    const [failedSrc, setFailedSrc] = useState<string>();

    useEffect(() => {
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      setLoaded({ blob, url });
      return () => URL.revokeObjectURL(url);
    }, [blob]);

    const externalSrc = markdownSrc && /^https?:\/\//i.test(markdownSrc) ? markdownSrc : undefined;
    const imageSrc = loaded && loaded.blob === blob ? loaded.url : externalSrc;
    const failed = error || (!resolvedPath && !externalSrc) || (imageSrc && failedSrc === imageSrc);
    if (failed) {
      const name = alt || (resolvedPath ?? markdownSrc)?.split(/[\\/]/).at(-1);
      return (
        <span
          role="status"
          style={{ color: cssVar.colorTextSecondary }}
          title={title ?? markdownSrc}
        >
          {name && <span>{name}</span>}
          {name && ' · '}
          {t('workingPanel.localFile.preview.imageUnavailable')}
        </span>
      );
    }

    if (!imageSrc) {
      return (
        <span
          aria-label={alt}
          role={alt ? 'img' : undefined}
          style={{
            background: cssVar.colorFillQuaternary,
            borderRadius: 6,
            display: 'inline-block',
            minHeight: 120,
            width: 'min(100%, 320px)',
          }}
          title={title ?? markdownSrc}
        />
      );
    }

    const imageWidth = dimension(width);
    const imageHeight = dimension(height);
    const imageStyle = {
      height: imageWidth === undefined ? imageHeight : 'auto',
      maxWidth: '100%',
      width: imageWidth,
      ...style,
    };
    const handleError = () => setFailedSrc(imageSrc);
    if (inline) {
      return (
        <img
          alt={alt}
          className={className}
          loading="lazy"
          src={imageSrc}
          style={imageStyle}
          title={title}
          onError={handleError}
        />
      );
    }

    return (
      <Image
        alt={alt}
        classNames={className ? { image: className } : undefined}
        objectFit="contain"
        src={imageSrc}
        styles={{ image: imageStyle }}
        title={title}
        variant="borderless"
        onError={handleError}
      />
    );
  },
);

MarkdownImage.displayName = 'MarkdownImage';

export default MarkdownImage;
