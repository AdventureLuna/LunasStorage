import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

type Photo = { id: string; object_path: string };
type Archive = { schema: string; version: number; exported_at: string; data: Record<string, unknown[]> };

export async function writeInventoryZip(
  archive: Archive,
  photos: Photo[],
  readPhoto: (photo: Photo) => Promise<ReadableStream<Uint8Array>>,
  progress: (status: string) => void,
  destination?: WritableStream<Uint8Array>,
): Promise<Blob | null> {
  const manifest = photos.map(photo => ({ id: photo.id, object_path: photo.object_path, archive_path: `photos/${photo.object_path}` }));
  const blobWriter = destination ? null : new BlobWriter('application/zip');
  const zip = new ZipWriter(destination ?? blobWriter!);
  await zip.add('inventory.json', new TextReader(JSON.stringify(archive, null, 2)));
  await zip.add('schema-readme.txt', new TextReader('Home storage inventory export v1.\nPhotos are stored under photos/ and referenced by item_photos.object_path. Archived items are included.'));
  await zip.add('photo-manifest.json', new TextReader(JSON.stringify(manifest, null, 2)));
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    progress(`Downloading and writing photo ${i + 1} of ${photos.length}`);
    await zip.add(manifest[i].archive_path, await readPhoto(photo), { level: 0 });
  }
  progress(`Finalizing backup (${photos.length} photos)`);
  const result = await zip.close();
  return destination ? null : result as Blob;
}
