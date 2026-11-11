import { isChatImage } from '@/utils/chatAttachments';

export type UnsupportedVisualUploadType = 'image' | 'video';

interface VisualUploadAbility {
  canUploadImage: boolean;
  canUploadVideo: boolean;
}

interface VisualUploadWarningOptions extends VisualUploadAbility {
  warning: (content: string) => void;
  warningText: string;
}

export const getUnsupportedVisualUploadType = (
  file: Pick<File, 'type'> & Partial<Pick<File, 'name'>>,
  { canUploadImage, canUploadVideo }: VisualUploadAbility,
): UnsupportedVisualUploadType | undefined => {
  if (isChatImage({ name: file.name ?? '', type: file.type }) && !canUploadImage) return 'image';
  if (file.type.startsWith('video') && !canUploadVideo) return 'video';
};

export const warnUnsupportedVisualUpload = (
  file: Pick<File, 'type'> & Partial<Pick<File, 'name'>>,
  { warning, warningText, ...ability }: VisualUploadWarningOptions,
) => {
  if (!getUnsupportedVisualUploadType(file, ability)) return false;

  warning(warningText);
  return true;
};
