import { newId } from './id';
import { boxLabel } from './box-label';
import { api, type ItemQuery } from './api';
import type { InventoryRow, Item } from './types';
export function address(item: InventoryRow) {
  return item.boxes ? `${item.boxes.locations.name} · ${boxLabel(item.boxes)}` : item.locations?.name ?? 'No location';
}
export const listItems = (options: ItemQuery) => api.listItems(options);
export const saveItem = (item: Partial<Item> & { name: string }, expected?: number) => api.saveItem(item, expected);
export const setPhotoOrder = (itemId: string, orderedIds: string[], coverId: string) => api.photoOrder(itemId, orderedIds, coverId);
export async function removePhotoRecord(photoId: string) { return (await api.deletePhoto(photoId)).warning; }
const photoIds = new WeakMap<File, string>();
export async function uploadPhoto(itemId: string, file: File) {
  let id = photoIds.get(file);
  if (!id) { id = newId(); photoIds.set(file, id); }
  return api.uploadPhoto(itemId, id, await compressImage(file));
}
async function compressImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw Error(`${file.name}: use JPEG, PNG or WebP. Convert HEIC/HEIF before selecting it.`);
  if (!globalThis.createImageBitmap) return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return file; }
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not process image')), 'image/jpeg', .88));
}
export async function photoUrl(path: string) { return `/api/photos/file?path=${encodeURIComponent(path)}`; }
export const exportRows = () => api.export();
export async function exportZip(progress: (status: string) => void, destination?: WritableStream<Uint8Array>): Promise<Blob | null> {
  progress('Creating a consistent local database and photo backup…');
  const response = await fetch('/api/backup', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok || !response.body) throw Error(`Backup failed (${response.status}). No complete backup was saved.`);
  progress('Downloading the local backup…');
  if (destination) { await response.body.pipeTo(destination); return null; }
  return response.blob();
}
export async function fetchAllPages<T>(fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>, pageSize = 500) {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  return all;
}
