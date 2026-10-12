"""Offline backup/restore and read-only Supabase migration.

All inventory/photo writes share the server's cross-process lock. Maintenance
that replaces/imports data additionally refuses to run while start.bat is active.
"""
from __future__ import annotations

import hashlib
import base64
import json
import math
import os
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from contextlib import closing, contextmanager
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

from filelock import FileLock

from .app import validated_image
from .store import Store, TABLES, now, safe_path, persistent_directory


def digest(content):
    return hashlib.sha256(content).hexdigest()


def atomic_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


@contextmanager
def stopped(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with FileLock(str(directory / '.server.lock'), timeout=0):
        yield


def create_backup(store: Store, output: Path | None = None) -> Path:
    destination = output.resolve() if output else store.root / f'backup-{uuid.uuid4()}.zip'
    if destination.exists():
        raise ValueError('Backup output already exists; choose a new filename')
    work = Path(tempfile.mkdtemp(prefix='backup-', dir=store.root)).resolve()
    pending = destination.with_name(destination.name + '.partial')
    try:
        with store.locked(), store.connect() as source:
            with closing(sqlite3.connect(work / 'inventory.sqlite3')) as snapshot:
                source.backup(snapshot)
                # Password hash is retained; active sessions are intentionally not portable.
                snapshot.execute('DELETE FROM sessions')
                snapshot.execute('DELETE FROM login_attempts')
                snapshot.commit()
                snapshot.row_factory = sqlite3.Row
                archive = store.export(snapshot)
            manifest = []
            with zipfile.ZipFile(pending, 'w', compression=zipfile.ZIP_DEFLATED) as zipped:
                zipped.write(work / 'inventory.sqlite3', 'inventory.sqlite3')
                zipped.writestr('inventory.json', json.dumps(archive, ensure_ascii=False))
                for photo in archive['data']['item_photos']:
                    path = safe_path(store.photos, photo['object_path'])
                    if not path.is_file():
                        raise ValueError(f"Backup incomplete: missing photo {photo['object_path']}")
                    content = path.read_bytes()
                    validated_image(content, compress=False)
                    name = 'photos/' + photo['object_path']
                    manifest.append({'id': photo['id'], 'object_path': photo['object_path'], 'archive_path': name, 'sha256': digest(content)})
                    zipped.writestr(name, content, compress_type=zipfile.ZIP_STORED)
                zipped.writestr('photo-manifest.json', json.dumps(manifest))
                zipped.writestr('local-backup.json', json.dumps({'format': 'lunas-local-backup', 'version': 1, 'database_sha256': digest((work / 'inventory.sqlite3').read_bytes()), 'created_at': now()}))
        pending.replace(destination)
        return destination
    finally:
        pending.unlink(missing_ok=True)
        assert work.is_relative_to(store.root)
        shutil.rmtree(work)


def validate_archive(archive, manifest):
    if archive.get('schema') != 'home-storage-inventory' or archive.get('version') != 1:
        raise ValueError('Expected home-storage-inventory JSON version 1')
    data = archive.get('data', {})
    maps = {}
    for table in TABLES:
        if not isinstance(data.get(table), list):
            raise ValueError(f'Missing {table} records')
        maps[table] = {}
        for row in data[table]:
            uuid.UUID(row['id'])
            if row['id'] in maps[table]:
                raise ValueError(f'Duplicate ID in {table}: {row["id"]}')
            if not isinstance(row.get('version', 1), int) or row.get('version', 1) < 1:
                raise ValueError(f'Invalid version in {table}')
            maps[table][row['id']] = row
    owners = {row.get('owner_id') for table in TABLES for row in data[table] if row.get('owner_id')}
    if len(owners) > 1:
        raise ValueError('Export includes multiple owners. Export a single Supabase account.')
    for location in data['locations']:
        if not isinstance(location.get('name'), str) or not location['name'].strip():
            raise ValueError('Location name is missing')
        visited = {location['id']}
        parent = location.get('parent_id')
        while parent:
            if parent in visited or parent not in maps['locations']:
                raise ValueError('Location has a cycle or missing parent')
            visited.add(parent)
            parent = maps['locations'][parent].get('parent_id')
    numbers = set()
    for box in data['boxes']:
        number = box['box_number']
        if not isinstance(number, int) or isinstance(number, bool) or number <= 0 or number in numbers:
            raise ValueError('Invalid or duplicate box number')
        numbers.add(number)
        if box.get('location_id') not in maps['locations']:
            raise ValueError('Box has a missing location')
    for item in data['items']:
        if not isinstance(item.get('name'), str) or not item['name'].strip():
            raise ValueError('Item name is missing')
        if bool(item.get('box_id')) == bool(item.get('location_id')):
            raise ValueError('Item must have exactly one destination')
        if item.get('box_id') and item['box_id'] not in maps['boxes'] or item.get('location_id') and item['location_id'] not in maps['locations']:
            raise ValueError('Item references a missing destination')
        if not isinstance(item.get('tags', []), list) or not all(isinstance(tag, str) for tag in item.get('tags', [])):
            raise ValueError('Invalid item tags')
    for table, columns in [('boxes', ['capacity_l']), ('items', ['quantity', 'volume_l'])]:
        for row in data[table]:
            for column in columns:
                if row.get(column) is not None and (isinstance(row[column], bool) or not math.isfinite(float(row[column])) or float(row[column]) < 0):
                    raise ValueError(f'Invalid {column}')
    if not isinstance(manifest, list):
        raise ValueError('Photo manifest is missing')
    by_photo = {}
    object_paths = set()
    archive_paths = set()
    for entry in manifest:
        photo = maps['item_photos'].get(entry['id'])
        if not photo or entry['id'] in by_photo or entry.get('object_path') != photo['object_path']:
            raise ValueError('Invalid or duplicate photo manifest entry')
        safe_path(Path.cwd(), photo['object_path'])
        name = entry['archive_path']
        safe_path(Path.cwd(), name)
        if not name.startswith('photos/') or name in archive_paths or photo['object_path'] in object_paths:
            raise ValueError('Unsafe or duplicate photo archive path')
        if photo['item_id'] not in maps['items'] or not isinstance(photo.get('sort_order'), int) or photo['sort_order'] < 0:
            raise ValueError('Photo has invalid item or order')
        object_paths.add(photo['object_path']); archive_paths.add(name)
        by_photo[photo['id']] = entry
    if set(by_photo) != set(maps['item_photos']):
        raise ValueError('Photo manifest does not cover all photos')
    return data, by_photo


def zip_input(zipped):
    names = zipped.namelist()
    if len(names) != len(set(names)):
        raise ValueError('ZIP contains duplicate filenames')
    if sum(info.file_size for info in zipped.infolist()) > 20 * 1024**3:
        raise ValueError('ZIP expands beyond the 20 GB safety limit')
    if zipped.getinfo('inventory.json').file_size > 100 * 1024**2:
        raise ValueError('Inventory JSON is too large')
    return json.loads(zipped.read('inventory.json')), json.loads(zipped.read('photo-manifest.json'))


def import_archive(store: Store, archive, manifest, read_photo):
    data, by_photo = validate_archive(archive, manifest)
    fingerprint = digest(json.dumps({'data': data, 'manifest': manifest, 'next_box_number': archive.get('next_box_number')}, sort_keys=True).encode())
    copied = 0
    with store.write() as db:
        previous = db.execute('SELECT report FROM import_jobs WHERE id=?', (fingerprint,)).fetchone()
        if previous:
            return dict(json.loads(previous['report']), already_imported=True)
        if any(db.execute(f'SELECT 1 FROM {table} LIMIT 1').fetchone() for table in TABLES):
            raise ValueError('Import requires an empty local inventory. Existing data is never overwritten.')
        # Stage copies first. If interrupted, a repeat validates and reuses matching files.
        for photo in data['item_photos']:
            entry = by_photo[photo['id']]
            content = read_photo(entry)
            validated_image(content, compress=False)
            if entry.get('sha256') and digest(content) != entry['sha256']:
                raise ValueError(f"Photo checksum mismatch: {entry['archive_path']}")
            destination = safe_path(store.photos, photo['object_path'])
            if destination.exists() and digest(destination.read_bytes()) != digest(content):
                raise ValueError(f"Conflicting staged photo: {photo['object_path']}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                temporary = destination.with_suffix('.partial')
                temporary.write_bytes(content)
                temporary.replace(destination)
            copied += 1
        # All records are committed together; IDs, timestamps and source owner metadata survive.
        db.execute('PRAGMA defer_foreign_keys=ON')
        for table in TABLES:
            allowed = {row['name'] for row in db.execute(f'PRAGMA table_info({table})')}
            for source in data[table]:
                row = {key: value for key, value in source.items() if key in allowed}
                if table != 'item_photos':
                    row.setdefault('version', 1)
                    row.setdefault('updated_at', now())
                row.setdefault('created_at', now())
                if table == 'items':
                    row['tags'] = json.dumps(row.get('tags', []), ensure_ascii=False)
                    row.setdefault('quantity_approximate', False)
                    row.setdefault('archived', False)
                    row['archived_at'] = row.get('archived_at') or now() if row['archived'] else None
                db.execute(f'INSERT INTO {table}(' + ','.join(row) + ') VALUES(' + ','.join('?' for _ in row) + ')', list(row.values()))
        next_number = max([box['box_number'] for box in data['boxes']], default=0) + 1
        original_next = archive.get('next_box_number', next_number)
        if not isinstance(original_next, int) or isinstance(original_next, bool) or original_next < next_number:
            raise ValueError('Invalid next_box_number: it must exceed all imported numbers')
        db.execute('UPDATE counters SET next_number=? WHERE id=1', (original_next,))
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Imported relationships failed validation')
        report = {'counts': {table: len(data[table]) for table in TABLES}, 'photos_copied': copied, 'missing_photos': [], 'completed_at': now()}
        db.execute('INSERT INTO import_jobs VALUES(?,?,?)', (fingerprint, now(), json.dumps(report)))
    return report


def import_zip(store: Store, source: Path):
    with zipfile.ZipFile(source) as zipped:
        archive, manifest = zip_input(zipped)
        validate_archive(archive, manifest)
        missing = [entry['archive_path'] for entry in manifest if entry['archive_path'] not in zipped.namelist()]
        if missing:
            raise ValueError('ZIP is missing photo files: ' + ', '.join(missing))
        return import_archive(store, archive, manifest, lambda entry: zipped.read(entry['archive_path']))


def restore_backup(source: Path, directory: Path):
    directory = persistent_directory(directory)
    with stopped(directory), FileLock(str(directory / '.inventory-write.lock'), timeout=60), zipfile.ZipFile(source) as zipped:
        if any(directory.glob('inventory.sqlite3*')):
            raise ValueError('Restore into a new empty data directory, then point INVENTORY_DATA_DIR at it.')
        archive, manifest = zip_input(zipped)
        validate_archive(archive, manifest)
        metadata = json.loads(zipped.read('local-backup.json'))
        if metadata.get('format') != 'lunas-local-backup' or metadata.get('version') != 1:
            raise ValueError('Not a local SQLite backup; use import-zip for a Supabase ZIP')
        content = zipped.read('inventory.sqlite3')
        if digest(content) != metadata['database_sha256']:
            raise ValueError('Database checksum mismatch')
        fingerprint = digest(content)
        marker = directory / '.restore-pending.json'
        photos = directory / 'photos'
        if marker.exists():
            if json.loads(marker.read_text())['fingerprint'] != fingerprint:
                raise ValueError('A different restore is in progress')
        elif photos.exists() and any(photos.rglob('*')):
            raise ValueError('Restore destination photos directory is not empty')
        atomic_json(marker, {'fingerprint': fingerprint})
        with tempfile.TemporaryDirectory(prefix='restore-') as temporary:
            staged = Path(temporary)
            (staged / 'inventory.sqlite3').write_bytes(content)
            restored = Store(staged)
            for entry in manifest:
                photo_bytes = zipped.read(entry['archive_path'])
                if not entry.get('sha256') or digest(photo_bytes) != entry['sha256']:
                    raise ValueError(f"Photo checksum mismatch: {entry['archive_path']}")
                validated_image(photo_bytes, compress=False)
                target = safe_path(restored.photos, entry['object_path'])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(photo_bytes)
            check = restored.verify()
            if check['integrity'] != 'ok' or check['foreign_key_errors'] or check['missing_photos'] or check['corrupt_photos']:
                raise ValueError(f'Restore validation failed: {check}')
            with restored.connect() as db:
                # Ensure the JSON and SQLite snapshot describe exactly the same inventory.
                actual = restored.export(db)['data']
                for table in TABLES:
                    target = {row['id']: row for row in actual[table]}
                    if len(target) != len(archive['data'][table]) or any(row['id'] not in target or any(target[row['id']].get(key) != value for key, value in row.items()) for row in archive['data'][table]):
                        raise ValueError('SQLite snapshot does not match the inventory export')
                db.execute('DELETE FROM sessions')
                db.execute('DELETE FROM login_attempts')
                db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            shutil.copytree(restored.photos, photos, dirs_exist_ok=True)
            pending = directory / 'inventory.restore.tmp'
            shutil.copy2(restored.database, pending)
            pending.replace(directory / 'inventory.sqlite3')
        marker.unlink()
        return check


def download_supabase(directory: Path, owner_id: str):
    uuid.UUID(owner_id)
    url = os.environ.get('MIGRATION_SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('MIGRATION_SUPABASE_KEY', '')
    token = os.environ.get('MIGRATION_SUPABASE_TOKEN', '') or key
    parsed_url = urlparse(url)
    if parsed_url.scheme != 'https' or not parsed_url.hostname or parsed_url.username or parsed_url.query or parsed_url.fragment or parsed_url.path or not key:
        raise ValueError('Set MIGRATION_SUPABASE_URL and MIGRATION_SUPABASE_KEY; optionally set MIGRATION_SUPABASE_TOKEN for an owner access token.')
    role = None
    try:
        payload = key.split('.')[1]
        role = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get('role')
    except (IndexError, ValueError, json.JSONDecodeError):
        pass
    if token == key and (key.startswith('sb_publishable_') or role == 'anon'):
        raise ValueError('A publishable/anon key also needs MIGRATION_SUPABASE_TOKEN for the owner. Anonymous RLS reads cannot migrate your private inventory.')
    directory.mkdir(parents=True, exist_ok=True)
    headers = {'apikey': key, 'Authorization': 'Bearer ' + token}

    def get(path):
        try:
            with urlopen(Request(url + path, headers=headers), timeout=60) as result:
                return result.read()
        except HTTPError as error:
            raise ValueError(f'Supabase read failed with HTTP {error.code}. Check local utility credentials and owner ID.') from error

    def records():
        data = {}
        for table in TABLES:
            rows = []
            for offset in range(0, 10_000_000, 500):
                query = urlencode({'select': '*', 'owner_id': 'eq.' + owner_id, 'order': 'id.asc', 'limit': 500, 'offset': offset})
                page = json.loads(get(f'/rest/v1/{table}?{query}'))
                rows.extend(page)
                if len(page) < 500:
                    break
            data[table] = rows
        return data

    snapshot = directory / 'inventory.json'
    def source_counter():
        query = urlencode({'select': 'next_number', 'owner_id': 'eq.' + owner_id})
        rows = json.loads(get('/rest/v1/box_number_counters?' + query))
        return rows[0]['next_number'] if rows else 1
    if snapshot.exists():
        archive = json.loads(snapshot.read_text(encoding='utf-8'))
    else:
        archive = {'schema': 'home-storage-inventory', 'version': 1, 'exported_at': now(), 'data': records(), 'next_box_number': source_counter()}
        atomic_json(snapshot, archive)
    manifest_path = directory / 'photo-manifest.json'
    old_manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    old_by_id = {entry['id']: entry for entry in old_manifest}
    manifest = [{'id': row['id'], 'object_path': row['object_path'], 'archive_path': 'photos/' + row['object_path']} for row in archive['data']['item_photos']]
    validate_archive(archive, manifest)
    failures = []
    for entry in manifest:
        target = safe_path(directory, entry['archive_path'])
        try:
            previous = old_by_id.get(entry['id'], {})
            if target.is_file() and previous.get('sha256') == digest(target.read_bytes()):
                entry['sha256'] = previous['sha256']
                continue
            content = get('/storage/v1/object/authenticated/inventory-photos/' + quote(entry['object_path'], safe='/'))
            validated_image(content, compress=False)
            target.parent.mkdir(parents=True, exist_ok=True)
            pending = target.with_suffix('.partial')
            pending.write_bytes(content); pending.replace(target)
            entry['sha256'] = digest(content)
        except (ValueError, OSError) as error:
            failures.append({'photo_id': entry['id'], 'path': entry['object_path'], 'error': str(error)})
        finally:
            atomic_json(manifest_path, manifest)
    changed = records() != archive['data'] or source_counter() != archive.get('next_box_number')
    report = {'counts': {table: len(archive['data'][table]) for table in TABLES}, 'missing_photos': failures, 'source_changed': changed}
    atomic_json(directory / 'migration-report.json', report)
    if failures or changed:
        raise ValueError('Download is incomplete or source records changed. See migration-report.json. Retry the same directory for missing files; use a new directory after source edits.')
    return report
