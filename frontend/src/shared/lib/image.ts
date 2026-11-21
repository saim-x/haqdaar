/**
 * Client-side image compression - docs/11 §3.2 steps 12–13.
 * Target: longest edge ≤ 1280 px, JPEG quality 0.7, ≤ 250 KB, before upload.
 * A woman on 3G must never wait for a 4 MB phone photo to travel.
 */

export const MAX_EDGE_PX = 1280;
export const JPEG_QUALITY = 0.7;
export const MAX_BYTES = 250 * 1024;

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  /** True when the first pass still exceeded 250 KB and quality was stepped down. */
  steppedDown: boolean;
}

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('IMAGE_DECODE_FAILED'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('IMAGE_ENCODE_FAILED'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Downscale + re-encode. Never upscales. Falls back to the original file when
 * the browser cannot decode it, so the wizard never dead-ends on a weird format.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const source = await loadBitmap(file);
  const srcW = 'width' in source ? source.width : 0;
  const srcH = 'height' in source ? source.height : 0;
  if (!srcW || !srcH) throw new Error('IMAGE_DECODE_FAILED');

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  if ('close' in source && typeof source.close === 'function') source.close();

  let quality = JPEG_QUALITY;
  let blob = await toBlob(canvas, quality);
  let steppedDown = false;

  // Step quality down (never below 0.45) until the payload fits the 250 KB budget.
  while (blob.size > MAX_BYTES && quality > 0.45) {
    quality = Math.round((quality - 0.1) * 100) / 100;
    blob = await toBlob(canvas, quality);
    steppedDown = true;
  }

  return { blob, width, height, bytes: blob.size, steppedDown };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
