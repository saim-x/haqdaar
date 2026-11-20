// Client-side compression (F-04): longest side <= 1280 px, JPEG ~0.7, target <= 250 KB.
// Saves bandwidth on weak connections before the photo ever leaves the phone.

const MAX_SIDE = 1280;
const TARGET_BYTES = 250 * 1024;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unsupported image'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Compression failed'))), 'image/jpeg', quality),
  );
}

export async function compressImage(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);

  let quality = 0.72;
  let blob = await toBlob(canvas, quality);
  while (blob.size > TARGET_BYTES && quality > 0.4) {
    quality -= 0.08;
    blob = await toBlob(canvas, quality);
  }
  return blob;
}
