'use client';
import { isHeic } from '@/lib/drivers';

// Phone photos are large. Shrink pictures in the browser so they upload quickly and stay under the 4 MB limit.
export async function shrink(file: File): Promise<File> {
  // iPhone photos can arrive as HEIC (for example when picked from the Files app); Safari can read them, so convert them here.
  const heic = isHeic(file);
  if (!heic && (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob && (heic || blob.size < file.size) ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
