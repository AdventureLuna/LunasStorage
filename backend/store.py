from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
import warnings
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from filelock import FileLock
from PIL import Image

TABLES = ('locations', 'boxes', 'items', 'item_photos')


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_data_dir() -> Path:
    return Path(os.environ.get('INVENTORY_DATA_DIR') or
                Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local' / 'share')) / 'LunasStorage').expanduser().resolve()


def persistent_directory(directory: Path) -> Path:
    resolved = directory.expanduser().resolve()
    if resolved.is_relative_to(Path(__file__).resolve().parent.parent):
        raise ValueError('Choose a data directory outside the source repository and frontend build')
    return resolved


def safe_path(root: Path, relative: str) -> Path:
    # Windows paths need the same validation when a backup is prepared on Linux.
    if not relative or '\\' in relative or ':' in relative or any(part in ('', '.', '..') for part in relative.split('/')):
        raise ValueError('Unsafe photo path')
    reserved = {'CON', 'PRN', 'AUX', 'NUL'} | {f'{prefix}{index}' for prefix in ('COM', 'LPT') for index in range(1, 10)}
    if any(part.rstrip(' .') != part or part.split('.')[0].upper() in reserved for part in relative.split('/')):
        raise ValueError('Photo path uses a Windows reserved filename')
    result = (root / relative).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError('Unsafe photo path')
    return result


def decode(row):
    if row is None:
        return None
    result = dict(row)
    if 'tags' in result:
        result['tags'] = json.loads(result['tags'])
    for name in ('archived', 'quantity_approximate', 'is_cover'):
        if name in result:
            result[name] = bool(result[name])
    return result


class Store:
    def __init__(self, directory: Path):
        self.root = persistent_directory(directory)
        self.root.mkdir(parents=True, exist_ok=True)
        self.photos = self.root / 'photos'
        self.photos.mkdir(exist_ok=True)
        self.database = self.root / 'inventory.sqlite3'
        self.lock_path = self.root / '.inventory-write.lock'
        self.migrate()

    @contextmanager
    def locked(self):
        with FileLock(str(self.lock_path), timeout=60):
            yield

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.create_function('casefold', 1, lambda value: str(value or '').casefold(), deterministic=True)
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=30000')
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def write(self):
        with self.locked(), self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def migrate(self):
        with self.locked(), self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)')
            paths = sorted((Path(__file__).parent / 'migrations').glob('*.sql'))
            known = {int(path.name.split('_')[0]) for path in paths}
            if any(row[0] not in known for row in db.execute('SELECT version FROM schema_migrations')):
                raise ValueError('Database is newer than this application. Install the matching version.')
            for path in paths:
                version = int(path.name.split('_')[0])
                sql = path.read_text(encoding='utf-8')
                checksum = hashlib.sha256(sql.encode()).hexdigest()
                previous = db.execute('SELECT checksum FROM schema_migrations WHERE version=?', (version,)).fetchone()
                if previous:
                    if previous[0] != checksum:
                        raise ValueError(f'Applied migration {version} has changed')
                    continue
                try:
                    db.executescript('BEGIN IMMEDIATE;\n' + sql)
                    db.execute('INSERT INTO schema_migrations VALUES(?,?,?)', (version, checksum, now()))
                    db.commit()
                except BaseException:
                    db.rollback()
                    raise

    def rows(self, table):
        if table not in TABLES:
            raise ValueError('Unknown table')
        with self.connect() as db:
            return [decode(row) for row in db.execute(f'SELECT * FROM {table}')]

    def item(self, db, item_id):
        result = decode(db.execute('SELECT * FROM items WHERE id=?', (item_id,)).fetchone())
        if result is None:
            return None
        result['locations'] = decode(db.execute('SELECT * FROM locations WHERE id=?', (result['location_id'],)).fetchone())
        box = decode(db.execute('SELECT * FROM boxes WHERE id=?', (result['box_id'],)).fetchone())
        if box:
            box['locations'] = decode(db.execute('SELECT * FROM locations WHERE id=?', (box['location_id'],)).fetchone())
        result['boxes'] = box
        result['item_photos'] = [decode(row) for row in db.execute('SELECT * FROM item_photos WHERE item_id=? ORDER BY sort_order,id', (item_id,))]
        return result

    def export(self, db):
        return {'schema': 'home-storage-inventory', 'version': 1, 'exported_at': now(),
                'next_box_number': db.execute('SELECT next_number FROM counters WHERE id=1').fetchone()[0],
                'data': {table: [decode(row) for row in db.execute(f'SELECT * FROM {table} ORDER BY id')] for table in TABLES}}

    def verify(self):
        with self.locked(), self.connect() as db:
            missing = [row['object_path'] for row in db.execute('SELECT object_path FROM item_photos')
                       if not safe_path(self.photos, row['object_path']).is_file()]
            known = {safe_path(self.photos, row['object_path']) for row in db.execute('SELECT object_path FROM item_photos')}
            corrupt = []
            for path in known:
                if not path.is_file():
                    continue
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter('error', Image.DecompressionBombWarning)
                        with Image.open(path) as image:
                            image.verify()
                except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
                    corrupt.append(str(path.relative_to(self.photos)))
            orphans = [str(path.relative_to(self.photos)) for path in self.photos.rglob('*') if path.is_file() and path.resolve() not in known]
            return {'integrity': db.execute('PRAGMA integrity_check').fetchone()[0],
                    'foreign_key_errors': [list(row) for row in db.execute('PRAGMA foreign_key_check')],
                    'missing_photos': missing, 'corrupt_photos': corrupt, 'orphan_files': orphans, 'counts': {table: db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in TABLES}}


def new_id():
    return str(uuid.uuid4())
