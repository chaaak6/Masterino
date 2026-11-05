/** Always publish image pixels. A data URL string is not an image clipboard fallback. */
const imageAsPng = async (imageUrl: string): Promise<Blob> => {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error('Image could not be loaded');
  const blob = await response.blob();
  if (blob.type === 'image/png') return blob;

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image could not be decoded'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image clipboard is unavailable');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('Image conversion failed'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const copyImageToClipboard = async (imageUrl: string): Promise<void> => {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
    throw new Error('Image clipboard is not supported');
  // Invoke write during the user gesture. PNG decoding may finish asynchronously.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageAsPng(imageUrl) })]);
};
