// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { writeInventoryZip } from './archive';

const archive = {
  schema: 'home-storage-inventory', version: 1, exported_at: '2026-01-01T00:00:00Z',
  data: { locations: [], boxes: [], items: [{ id: 'item-1', archived: true }], item_photos: [{ id: 'photo-1', object_path: 'owner/item/photo.jpg' }] },
};
const photos = [{ id: 'photo-1', object_path: 'owner/item/photo.jpg' }];
const readPhoto = async () => new Blob(['photo bytes']).stream();

async function readArchive(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const readText = async (name: string) => {
      const entry = entries.find(value => value.filename === name);
      if (!entry || entry.directory) throw new Error(`Missing ${name}`);
      return entry.getData(new TextWriter());
    };
    return { inventory: JSON.parse(await readText('inventory.json')), manifest: JSON.parse(await readText('photo-manifest.json')), photo: await readText('photos/owner/item/photo.jpg') };
  } finally { await reader.close(); }
}

describe('backup ZIP writing', () => {
  it('includes the full JSON, relative photo manifest and photo bytes in the in-memory fallback', async () => {
    const blob = await writeInventoryZip(archive, photos, readPhoto, () => {});
    expect(blob).toBeInstanceOf(Blob);
    const result = await readArchive(blob!);
    expect(result.inventory.data.items[0]).toMatchObject({ id: 'item-1', archived: true });
    expect(result.manifest).toEqual([{ id: 'photo-1', object_path: 'owner/item/photo.jpg', archive_path: 'photos/owner/item/photo.jpg' }]);
    expect(result.photo).toBe('photo bytes');
  });

  it('streams ZIP bytes to a writable destination without returning a Blob', async () => {
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const output = new Response(stream.readable).blob();
    const result = await writeInventoryZip(archive, photos, readPhoto, () => {}, stream.writable);
    expect(result).toBeNull();
    expect((await readArchive(await output)).photo).toBe('photo bytes');
  });

  it('rejects the backup if any photo cannot be read', async () => {
    await expect(writeInventoryZip(archive, photos, async () => { throw new Error('network down'); }, () => {})).rejects.toThrow('network down');
  });
});
