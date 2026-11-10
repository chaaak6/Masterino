import { memo } from 'react';
import ImageGallery from '@/features/Attachments/ImageGallery';

interface ImageFileItem {
  alt?: string;
  id: string;
  url: string;
}
export default memo(({ items }: { items: ImageFileItem[] }) => (
  <ImageGallery
    items={items.map((item) => ({ id: item.id, name: item.alt || 'Image', url: item.url }))}
  />
));
