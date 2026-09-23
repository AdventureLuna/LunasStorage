import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import process, { stdin, stdout, argv, env } from 'node:process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { validateRestoreArchive } from './restore-core.mjs';

async function prompt(label) {
  const rl = createInterface({ input: stdin, output: stdout });
  try { return await rl.question(label); } finally { rl.close(); }
}

async function promptSecret(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Run this restore utility in an interactive terminal so it can read the password without echoing it.');
  stdout.write(label);
  stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); stdout.write('\n'); if (error) reject(error); else resolve(value); };
    const onData = (buffer) => {
      for (const char of buffer.toString('utf8')) {
        if (char === '\u0003') return done(new Error('Cancelled.'));
        if (char === '\r' || char === '\n') return done();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function cleanup(db, paths) {
  const failures = [];
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await db.storage.from('inventory-photos').remove(batch);
    if (error) failures.push(...batch);
  }
  return failures;
}

async function main() {
  if (typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const archivePath = argv[2];
  if (!archivePath) throw new Error('Usage: npm run restore -- <backup.zip>');
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local first.');
  const zip = await JSZip.loadAsync(await readFile(archivePath), { checkCRC32: true });
  const inventoryFile = zip.file('inventory.json'), manifestFile = zip.file('photo-manifest.json');
  if (!inventoryFile || !manifestFile) throw new Error('This is not a full backup ZIP. Both inventory.json and photo-manifest.json are required.');
  const archive = JSON.parse(await inventoryFile.async('string'));
  const manifest = JSON.parse(await manifestFile.async('string'));
  const { data, manifestByPhoto } = validateRestoreArchive(archive, manifest);
  const photoBuffers = new Map();
  for (const [photoId, entry] of manifestByPhoto) {
    const file = zip.file(entry.archive_path);
    if (!file) throw new Error(`Backup photo file is missing: ${entry.archive_path}`);
    const bytes = await file.async('nodebuffer');
    if (bytes.length < 3 || bytes.length > 15 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error(`Photo is not a supported JPEG or exceeds the 15 MB limit: ${entry.archive_path}`);
    photoBuffers.set(photoId, bytes);
  }
  const email = await prompt('Supabase account email: '), password = await promptSecret('Password (hidden): ');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.signInWithPassword({ email, password });
  if (authError || !auth.user) throw new Error(`Sign in failed: ${authError?.message ?? 'no user returned'}`);
  const ownerId = auth.user.id;
  const stagedPaths = [];
  try {
    for (const table of ['locations', 'boxes', 'items', 'item_photos']) {
      const { count, error } = await db.from(table).select('id', { count: 'exact', head: true });
      if (error) throw new Error(`Could not verify the target inventory is empty (${table}): ${error.message}`);
      if (count !== 0) throw new Error(`Restore refused: ${table} already has ${count} row(s). This tool never merges or overwrites.`);
    }
    const remappedPhotos = [];
    let number = 0;
    for (const photo of data.item_photos) {
      number++;
      const objectPath = `${ownerId}/${photo.item_id}/${randomUUID()}.jpg`;
      stagedPaths.push(objectPath);
      stdout.write(`Uploading restore photo ${number}/${data.item_photos.length}\r`);
      const { error } = await db.storage.from('inventory-photos').upload(objectPath, photoBuffers.get(photo.id), { contentType: 'image/jpeg', upsert: false });
      if (error) throw new Error(`Photo upload failed. Restore has not started: ${error.message}`);
      remappedPhotos.push({ ...photo, object_path: objectPath });
    }
    stdout.write('\n');
    const payload = { ...archive, data: { ...data, item_photos: remappedPhotos } };
    const { data: result, error: restoreError, status: restoreStatus } = await db.rpc('restore_inventory', { archive_payload: payload });
    if (restoreError) {
      const cleanupFailures = restoreStatus >= 400 ? await cleanup(db, stagedPaths) : stagedPaths;
      throw new Error(`Database restore failed (${restoreError.message}). Uploaded photo objects were ${cleanupFailures.length ? 'not fully removed' : 'removed'}.${cleanupFailures.length ? ` Check and remove these owner paths manually: ${cleanupFailures.join(', ')}` : ''}`);
    }
    stdout.write(`Restore complete: ${result.locations} locations, ${result.boxes} boxes, ${result.items} items, ${result.item_photos} photos.\n`);
  } catch (error) {
    if (stagedPaths.length && !String(error.message).includes('Uploaded photo objects')) {
      const failedCleanup = await cleanup(db, stagedPaths);
      if (failedCleanup.length) error.message += ` Manual cleanup required for: ${failedCleanup.join(', ')}`;
    }
    throw error;
  } finally {
    await db.auth.signOut({ scope: 'local' });
  }
}

main().catch(error => { process.stderr.write(`Restore stopped: ${error.message}\n`); process.exitCode = 1; });
