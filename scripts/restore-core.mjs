const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateRestoreArchive(archive, manifest) {
  if (!archive || archive.schema !== 'home-storage-inventory' || archive.version !== 1 || !archive.data) throw new Error('Unsupported inventory JSON schema. Expected home-storage-inventory version 1.');
  const data = archive.data;
  for (const table of ['locations', 'boxes', 'items', 'item_photos']) if (!Array.isArray(data[table])) throw new Error(`Archive is missing the ${table} array.`);
  const maps = Object.fromEntries(['locations', 'boxes', 'items', 'item_photos'].map(table => [table, new Map()]));
  for (const table of Object.keys(maps)) for (const row of data[table]) {
    if (!uuidPattern.test(row.id ?? '') || maps[table].has(row.id)) throw new Error(`${table} contains a missing or duplicate UUID.`);
    maps[table].set(row.id, row);
  }
  for (const location of data.locations) {
    if (typeof location.name !== 'string' || !location.name.trim()) throw new Error(`Location ${location.id} has no name.`);
    if (location.parent_id && !maps.locations.has(location.parent_id)) throw new Error(`Location ${location.id} references a missing parent.`);
  }
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error('Location hierarchy contains a cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    const parent = maps.locations.get(id)?.parent_id;
    if (parent) visit(parent);
    visiting.delete(id); visited.add(id);
  };
  for (const id of maps.locations.keys()) visit(id);
  const boxNumbers = new Set();
  for (const box of data.boxes) {
    const number = Number(box.box_number);
    if (!Number.isSafeInteger(number) || number < 1 || boxNumbers.has(number)) throw new Error(`Box ${box.id} has an invalid or duplicate number.`);
    boxNumbers.add(number);
    if (!maps.locations.has(box.location_id)) throw new Error(`Box ${box.id} references a missing location.`);
    if (box.capacity_l != null && (!Number.isFinite(Number(box.capacity_l)) || Number(box.capacity_l) < 0)) throw new Error(`Box ${box.id} has an invalid or negative capacity.`);
  }
  for (const item of data.items) {
    if (typeof item.name !== 'string' || !item.name.trim()) throw new Error(`Item ${item.id} has no name.`);
    if (Boolean(item.location_id) === Boolean(item.box_id)) throw new Error(`Item ${item.id} must have exactly one destination.`);
    if (item.location_id && !maps.locations.has(item.location_id)) throw new Error(`Item ${item.id} references a missing location.`);
    if (item.box_id && !maps.boxes.has(item.box_id)) throw new Error(`Item ${item.id} references a missing box.`);
    if (item.quantity != null && (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0)) throw new Error(`Item ${item.id} has an invalid or negative quantity.`);
    if (item.volume_l != null && (!Number.isFinite(Number(item.volume_l)) || Number(item.volume_l) < 0)) throw new Error(`Item ${item.id} has an invalid or negative volume.`);
  }
  if (!Array.isArray(manifest)) throw new Error('ZIP photo-manifest.json is missing or invalid.');
  const manifestByPhoto = new Map(), archivePaths = new Set();
  for (const row of manifest) {
    if (!maps.item_photos.has(row.id) || manifestByPhoto.has(row.id)) throw new Error('Photo manifest has a missing or duplicate photo ID.');
    const photo = maps.item_photos.get(row.id);
    if (row.object_path !== photo.object_path || typeof row.archive_path !== 'string' || !row.archive_path.startsWith('photos/')) throw new Error(`Photo manifest entry ${row.id} does not match metadata.`);
    if (archivePaths.has(row.archive_path)) throw new Error(`Duplicate photo archive path: ${row.archive_path}`);
    const parts = row.archive_path.split('/');
    if (parts.some(part => part === '..' || part === '.' || !part)) throw new Error(`Unsafe photo archive path: ${row.archive_path}`);
    if (!maps.items.has(photo.item_id)) throw new Error(`Photo ${photo.id} references a missing item.`);
    const sourceOwner = maps.items.get(photo.item_id).owner_id, objectParts = photo.object_path.split('/');
    if (!sourceOwner || objectParts.length !== 3 || objectParts[0] !== sourceOwner || objectParts[1] !== photo.item_id || !/^[A-Za-z0-9._-]+$/.test(objectParts[2])) throw new Error(`Photo ${photo.id} has an invalid owner/item object path.`);
    archivePaths.add(row.archive_path); manifestByPhoto.set(row.id, row);
  }
  if (manifestByPhoto.size !== data.item_photos.length) throw new Error('The photo manifest is incomplete.');
  return { data, manifestByPhoto };
}
