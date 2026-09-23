import { describe, expect, it } from 'vitest';
import { validateRestoreArchive } from '../scripts/restore-core.mjs';

const locationId = '11111111-1111-4111-8111-111111111111';
const boxId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base = () => ({ schema: 'home-storage-inventory', version: 1, data: {
  locations: [{ id: locationId, owner_id: ownerId, name: 'Basement', parent_id: null }],
  boxes: [{ id: boxId, owner_id: ownerId, box_number: 2, location_id: locationId, description: null, capacity_l: null }],
  items: [{ id: itemId, owner_id: ownerId, name: 'Parts', box_id: boxId, location_id: null, quantity: null, volume_l: null }],
  item_photos: [],
} });

describe('restore archive validation', () => {
  it('accepts valid IDs/relationships and preserves unknown quantity', () => {
    expect(validateRestoreArchive(base(), []).data.items[0].quantity).toBeNull();
  });
  it('rejects items with both or neither destination', () => {
    const both = base(); both.data.items[0].location_id = locationId;
    expect(() => validateRestoreArchive(both, [])).toThrow(/exactly one destination/);
    const neither = base(); neither.data.items[0].box_id = null;
    expect(() => validateRestoreArchive(neither, [])).toThrow(/exactly one destination/);
  });
  it('rejects broken references and location cycles before upload', () => {
    const missing = base(); missing.data.items[0].box_id = '44444444-4444-4444-8444-444444444444';
    expect(() => validateRestoreArchive(missing, [])).toThrow(/missing box/);
    const cycle = base(); cycle.data.locations.push({ id: '44444444-4444-4444-8444-444444444444', owner_id: ownerId, name: 'Upstairs', parent_id: locationId }); cycle.data.locations[0].parent_id = cycle.data.locations[1].id;
    expect(() => validateRestoreArchive(cycle, [])).toThrow(/cycle/);
  });
  it('requires every photo and rejects paths outside the source owner/item', () => {
    const archive = base(); archive.data.item_photos.push({ id: '55555555-5555-4555-8555-555555555555', owner_id: ownerId, item_id: itemId, object_path: `${ownerId}/${itemId}/photo.jpg` });
    expect(() => validateRestoreArchive(archive, [])).toThrow(/manifest is incomplete/);
    const manifest = [{ id: archive.data.item_photos[0].id, object_path: archive.data.item_photos[0].object_path, archive_path: `photos/${ownerId}/${itemId}/photo.jpg` }];
    expect(validateRestoreArchive(archive, manifest).manifestByPhoto.size).toBe(1);
    archive.data.item_photos[0].object_path = `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/${itemId}/photo.jpg`; manifest[0].object_path = archive.data.item_photos[0].object_path;
    expect(() => validateRestoreArchive(archive, manifest)).toThrow(/invalid owner\/item/);
  });
});
