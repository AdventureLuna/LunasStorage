from __future__ import annotations

import io
import json
import secrets
import shlex
import sqlite3
import time
import warnings
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from PIL import Image, ImageOps

from .security import password_hash, password_matches, token_hash
from .store import Store, decode, default_data_dir, new_id, now, safe_path

ROOT = Path(__file__).resolve().parent.parent
MAX_UPLOAD = 15 * 1024 * 1024
SESSION_AGE = 7 * 24 * 3600


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Login(Model):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


class LocationInput(Model):
    name: str = Field(min_length=1, max_length=500)
    parent_id: str | None = None
    expected_version: int | None = Field(default=None, ge=1)


class BoxInput(Model):
    location_id: str
    description: str | None = Field(default=None, max_length=1000)
    capacity_l: float | None = Field(default=None, ge=0)
    expected_version: int | None = Field(default=None, ge=1)


class ItemInput(Model):
    id: str | None = None
    name: str = Field(min_length=1, max_length=1000)
    notes: str | None = Field(default=None, max_length=100000)
    tags: list[str] = Field(default_factory=list, max_length=100)
    quantity: float | None = Field(default=None, ge=0)
    quantity_unit: str | None = Field(default=None, max_length=100)
    quantity_approximate: bool = False
    volume_l: float | None = Field(default=None, ge=0)
    location_id: str | None = None
    box_id: str | None = None
    archived: bool = False
    archived_at: str | None = None
    expected_version: int | None = Field(default=None, ge=1)


class ArchiveInput(Model):
    archived: bool
    expected_version: int = Field(ge=1)


class MoveInput(Model):
    item_ids: list[str] = Field(min_length=1, max_length=500)
    destination_id: str
    destination_type: Literal['box', 'location']


class SelectedItem(Model):
    id: str
    version: int = Field(ge=1)


class DeleteItemsInput(Model):
    items: list[SelectedItem] = Field(min_length=1, max_length=500)


class PhotoOrder(Model):
    ordered_photo_ids: list[str]
    cover_photo_id: str


def require_version(db, table, row_id, expected):
    row = db.execute(f'SELECT * FROM {table} WHERE id=?', (row_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Record is unavailable')
    if expected is None or row['version'] != expected:
        raise HTTPException(409, 'This record changed elsewhere. Reload it and apply your edits again.')
    return row


def ensure_name(name):
    if not name.strip():
        raise HTTPException(422, 'A name is required')
    return name.strip()


def validated_image(content: bytes, compress=True) -> bytes:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                if image.format not in ('JPEG', 'PNG', 'WEBP'):
                    raise ValueError('Use JPEG, PNG or WebP photos')
                image.verify()
            if not compress:
                return content
            with Image.open(io.BytesIO(content)) as image:
                image = ImageOps.exif_transpose(image).convert('RGB')
                image.thumbnail((2048, 2048))
                output = io.BytesIO()
                image.save(output, 'JPEG', quality=88)
                return output.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError(f'Invalid or unsupported photo: {error}') from error


def create_app(directory: Path | None = None, frontend: Path | None = None):
    store = Store(directory or default_data_dir())
    build = (frontend or ROOT / 'dist').resolve()
    app = FastAPI(title='LunasStorage local API', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store

    @app.exception_handler(sqlite3.IntegrityError)
    async def integrity_error(_request, _error):
        return JSONResponse({'detail': 'Invalid relationship or a record is still in use. Move contained locations, boxes or items first.'}, status_code=409)

    @app.middleware('http')
    async def local_origin(request: Request, call_next):
        if request.url.path.startswith('/api') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('origin')
            if request.headers.get('x-inventory-client') != 'local' or (origin and urlparse(origin).netloc != request.headers.get('host')):
                return JSONResponse({'detail': 'Request must come from this inventory app'}, status_code=403)
            try:
                length = int(request.headers.get('content-length', '0'))
            except ValueError:
                return JSONResponse({'detail': 'Invalid content length'}, status_code=400)
            if length > MAX_UPLOAD + 1024 * 1024:
                return JSONResponse({'detail': 'Upload exceeds 15 MB'}, status_code=413)
        result = await call_next(request)
        result.headers['X-Content-Type-Options'] = 'nosniff'
        result.headers['Referrer-Policy'] = 'same-origin'
        if request.url.path.startswith('/api'):
            result.headers['Cache-Control'] = 'no-store'
        else:
            result.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'"
        return result

    def current_user(request: Request):
        token = request.cookies.get('inventory_session', '')
        with store.connect() as db:
            session = db.execute('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?', (token_hash(token), time.time())).fetchone()
            account = db.execute('SELECT username FROM account WHERE id=1').fetchone()
        if not session or not account:
            raise HTTPException(401, 'Sign in to your local inventory')
        return {'id': 'local', 'email': account['username']}

    def login_response(response, db):
        token = secrets.token_urlsafe(32)
        db.execute('DELETE FROM sessions WHERE expires_at<?', (time.time(),))
        db.execute('INSERT INTO sessions VALUES(?,?)', (token_hash(token), time.time() + SESSION_AGE))
        response.set_cookie('inventory_session', token, max_age=SESSION_AGE, httponly=True, samesite='strict', path='/')

    @app.get('/api/auth/status')
    def auth_status(request: Request):
        with store.connect() as db:
            setup_required = db.execute('SELECT 1 FROM account').fetchone() is None
        try:
            session = {'user': current_user(request)}
        except HTTPException:
            session = None
        return {'setup_required': setup_required, 'session': session}

    @app.post('/api/auth/setup')
    def setup(body: Login, request: Request, response: Response):
        if request.client.host not in ('127.0.0.1', '::1'):
            raise HTTPException(403, 'Create the first account on the PC at http://localhost:8000')
        if len(body.password) < 8:
            raise HTTPException(422, 'Use at least 8 characters for the password')
        with store.write() as db:
            if db.execute('SELECT 1 FROM account').fetchone():
                raise HTTPException(409, 'The local account already exists; sign in instead')
            db.execute('INSERT INTO account VALUES(1,?,?)', (ensure_name(body.username), password_hash(body.password)))
            login_response(response, db)
        return {'user': {'id': 'local', 'email': body.username}}

    @app.post('/api/auth/login')
    def login(body: Login, request: Request, response: Response):
        address = request.client.host
        # Expensive password verification and attempt updates are serialized across requests.
        denied = False
        with store.write() as db:
            previous = db.execute('SELECT * FROM login_attempts WHERE address=?', (address,)).fetchone()
            if previous and previous['first_at'] > time.time() - 300 and previous['attempts'] >= 10:
                raise HTTPException(429, 'Too many attempts. Wait five minutes and retry.')
            account = db.execute('SELECT * FROM account').fetchone()
            if not account or body.username != account['username'] or not password_matches(body.password, account['password_hash']):
                denied = True
                attempts = previous['attempts'] + 1 if previous and previous['first_at'] > time.time() - 300 else 1
                first_at = previous['first_at'] if attempts > 1 else time.time()
                db.execute('INSERT OR REPLACE INTO login_attempts VALUES(?,?,?)', (address, attempts, first_at))
            else:
                db.execute('DELETE FROM login_attempts WHERE address=?', (address,))
                login_response(response, db)
        if denied:
            raise HTTPException(401, 'Incorrect username or password')
        return {'user': {'id': 'local', 'email': body.username}}

    @app.post('/api/auth/logout')
    def logout(request: Request, response: Response):
        with store.write() as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash(request.cookies.get('inventory_session', '')),))
        response.delete_cookie('inventory_session', path='/')
        return {'ok': True}

    protected = [Depends(current_user)]

    @app.get('/api/locations', dependencies=protected)
    def locations():
        return sorted(store.rows('locations'), key=lambda row: row['name'].casefold())

    def save_location(body, row_id=None):
        with store.write() as db:
            name = ensure_name(body.name)
            target = row_id or new_id()
            ancestor = body.parent_id
            visited = {target}
            while ancestor:
                if ancestor in visited:
                    raise HTTPException(409, 'Location nesting cannot contain a cycle')
                visited.add(ancestor)
                row = db.execute('SELECT parent_id FROM locations WHERE id=?', (ancestor,)).fetchone()
                if not row:
                    raise HTTPException(422, 'Parent location is unavailable')
                ancestor = row['parent_id']
            if row_id:
                require_version(db, 'locations', row_id, body.expected_version)
                db.execute('UPDATE locations SET name=?,parent_id=?,version=version+1,updated_at=? WHERE id=?', (name, body.parent_id, now(), row_id))
            else:
                db.execute('INSERT INTO locations(id,name,parent_id,version,created_at,updated_at) VALUES(?,?,?,1,?,?)', (target, name, body.parent_id, now(), now()))
            return decode(db.execute('SELECT * FROM locations WHERE id=?', (target,)).fetchone())

    @app.post('/api/locations', dependencies=protected)
    def add_location(body: LocationInput):
        return save_location(body)

    @app.put('/api/locations/{row_id}', dependencies=protected)
    def edit_location(row_id: str, body: LocationInput):
        return save_location(body, row_id)

    @app.delete('/api/locations/{row_id}', dependencies=protected)
    def delete_location(row_id: str, version: int):
        with store.write() as db:
            require_version(db, 'locations', row_id, version)
            db.execute('DELETE FROM locations WHERE id=?', (row_id,))
        return {'ok': True}

    @app.get('/api/boxes', dependencies=protected)
    def boxes():
        return sorted(store.rows('boxes'), key=lambda row: row['box_number'])

    def save_box(body, row_id=None):
        with store.write() as db:
            target = row_id or new_id()
            if row_id:
                require_version(db, 'boxes', row_id, body.expected_version)
                db.execute('UPDATE boxes SET location_id=?,description=?,capacity_l=?,version=version+1,updated_at=? WHERE id=?', (body.location_id, body.description, body.capacity_l, now(), row_id))
            else:
                number = db.execute('SELECT next_number FROM counters WHERE id=1').fetchone()[0]
                db.execute('UPDATE counters SET next_number=next_number+1 WHERE id=1')
                db.execute('INSERT INTO boxes(id,box_number,location_id,description,capacity_l,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)', (target, number, body.location_id, body.description, body.capacity_l, now(), now()))
            return decode(db.execute('SELECT * FROM boxes WHERE id=?', (target,)).fetchone())

    @app.post('/api/boxes', dependencies=protected)
    def add_box(body: BoxInput):
        return save_box(body)

    @app.put('/api/boxes/{row_id}', dependencies=protected)
    def edit_box(row_id: str, body: BoxInput):
        return save_box(body, row_id)

    @app.delete('/api/boxes/{row_id}', dependencies=protected)
    def delete_box(row_id: str, version: int):
        with store.write() as db:
            require_version(db, 'boxes', row_id, version)
            db.execute('DELETE FROM boxes WHERE id=?', (row_id,))
        return {'ok': True}

    @app.get('/api/box-estimates', dependencies=protected)
    def estimates():
        with store.connect() as db:
            return [dict(row) for row in db.execute('SELECT b.id AS box_id,coalesce(sum(i.volume_l),0) AS known_volume_l,count(i.id)-count(i.volume_l) AS missing_estimate_count FROM boxes b LEFT JOIN items i ON i.box_id=b.id AND i.archived=0 GROUP BY b.id')]

    @app.get('/api/items', dependencies=protected)
    def items(search: str = '', location: str = '', box: str = '', tag: str = '', archived: bool = False, out: bool = False, page: int = Query(0, ge=0), pageSize: int = Query(30, ge=1, le=100)):
        clauses = ['i.archived=?']
        values = [int(archived)]
        if location:
            clauses.append('(i.location_id=? OR b.location_id=?)')
            values.extend([location, location])
        if box:
            clauses.append('i.box_id=?'); values.append(box)
        if tag:
            clauses.append('EXISTS(SELECT 1 FROM json_each(i.tags) WHERE value=?)'); values.append(tag)
        if out:
            clauses.append('i.quantity=0')
        try:
            terms = shlex.split(search)
        except ValueError:
            terms = search.split()
        for term in terms[:30]:
            clauses.append("casefold(coalesce(i.name,'')||' '||coalesce(i.notes,'')||' '||i.tags||' '||coalesce(b.description,'')||' '||coalesce(b.box_number,'')||' '||coalesce(l.name,'')||' '||coalesce(bl.name,'')) LIKE ? ESCAPE '\\'")
            values.append('%' + term.casefold().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%')
        sql = ' FROM items i LEFT JOIN boxes b ON b.id=i.box_id LEFT JOIN locations l ON l.id=i.location_id LEFT JOIN locations bl ON bl.id=b.location_id WHERE ' + ' AND '.join(clauses)
        with store.connect() as db:
            db.execute('BEGIN')
            count = db.execute('SELECT count(*)' + sql, values).fetchone()[0]
            ids = db.execute('SELECT i.id' + sql + ' ORDER BY i.created_at DESC,i.id LIMIT ? OFFSET ?', values + [pageSize, page * pageSize]).fetchall()
            result = [store.item(db, row['id']) for row in ids]
        return {'items': result, 'count': count}

    @app.get('/api/items/{row_id}', dependencies=protected)
    def item(row_id: str):
        with store.connect() as db:
            result = store.item(db, row_id)
        if not result:
            raise HTTPException(404, 'Item is unavailable')
        return result

    def save_item(body: ItemInput, row_id=None):
        if bool(body.box_id) == bool(body.location_id):
            raise HTTPException(422, 'Choose exactly one box or location')
        with store.write() as db:
            target = row_id or body.id or new_id()
            # Client-generated UUIDs make retrying an uncertain initial save idempotent.
            existing = db.execute('SELECT * FROM items WHERE id=?', (target,)).fetchone()
            if not row_id and existing:
                return store.item(db, target)
            if row_id:
                require_version(db, 'items', row_id, body.expected_version)
            fields = body.model_dump(exclude={'id', 'expected_version'})
            fields['name'] = ensure_name(body.name)
            fields['tags'] = json.dumps(body.tags, ensure_ascii=False)
            fields['archived_at'] = body.archived_at or now() if body.archived else None
            fields['updated_at'] = now()
            if row_id:
                db.execute('UPDATE items SET ' + ','.join(f'{key}=?' for key in fields) + ',version=version+1 WHERE id=?', list(fields.values()) + [target])
            else:
                fields.update(id=target, version=1, created_at=now())
                db.execute('INSERT INTO items(' + ','.join(fields) + ') VALUES(' + ','.join('?' for _ in fields) + ')', list(fields.values()))
            return store.item(db, target)

    @app.post('/api/items', dependencies=protected)
    def add_item(body: ItemInput):
        return save_item(body)

    @app.put('/api/items/{row_id}', dependencies=protected)
    def edit_item(row_id: str, body: ItemInput):
        return save_item(body, row_id)

    @app.post('/api/items/{row_id}/archive', dependencies=protected)
    def archive_item(row_id: str, body: ArchiveInput):
        with store.write() as db:
            require_version(db, 'items', row_id, body.expected_version)
            db.execute('UPDATE items SET archived=?,archived_at=?,version=version+1,updated_at=? WHERE id=?', (body.archived, now() if body.archived else None, now(), row_id))
            return store.item(db, row_id)

    @app.post('/api/items/delete', dependencies=protected)
    def delete_items(body: DeleteItemsInput):
        ids = [item.id for item in body.items]
        if len(set(ids)) != len(ids):
            raise HTTPException(422, 'Select each item only once')
        warnings = []
        with store.write() as db:
            # Validate every selection before deleting any records or touching files.
            for item in body.items:
                require_version(db, 'items', item.id, item.version)
            placeholders = ','.join('?' for _ in ids)
            paths = [row['object_path'] for row in db.execute(f'SELECT object_path FROM item_photos WHERE item_id IN({placeholders})', ids)]
            db.execute(f'DELETE FROM items WHERE id IN({placeholders})', ids)
            # Metadata is committed atomically, including cascading photo records.
            # Files are removed afterward so a rollback never leaves live items without photos.
            db.commit()
            for path in paths:
                try:
                    safe_path(store.photos, path).unlink(missing_ok=True)
                except (OSError, ValueError):
                    warnings.append(path)
        return {'deleted': len(ids), 'photo_cleanup_failures': warnings}

    @app.post('/api/moves', dependencies=protected)
    def moves(body: MoveInput):
        unique = set(body.item_ids)
        with store.write() as db:
            table = 'boxes' if body.destination_type == 'box' else 'locations'
            if not db.execute(f'SELECT 1 FROM {table} WHERE id=?', (body.destination_id,)).fetchone():
                raise HTTPException(422, 'Destination is unavailable')
            placeholders = ','.join('?' for _ in unique)
            if len(unique) != len(body.item_ids) or db.execute(f'SELECT count(*) FROM items WHERE id IN({placeholders})', list(unique)).fetchone()[0] != len(unique):
                raise HTTPException(409, 'One or more items are unavailable; no items moved')
            db.execute(f'UPDATE items SET box_id=?,location_id=?,version=version+1,updated_at=? WHERE id IN({placeholders})', [body.destination_id if table == 'boxes' else None, body.destination_id if table == 'locations' else None, now()] + list(unique))
        return {'moved': len(unique)}

    @app.post('/api/items/{row_id}/photos', dependencies=protected)
    def upload_photo(row_id: str, photo_id: str, file: UploadFile):
        import uuid
        try:
            uuid.UUID(photo_id)
            uuid.UUID(row_id)
        except ValueError:
            raise HTTPException(422, 'Invalid photo or item ID')
        content = file.file.read(MAX_UPLOAD + 1)
        if len(content) > MAX_UPLOAD:
            raise HTTPException(413, 'Photo exceeds 15 MB')
        try:
            compressed = validated_image(content)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        path = f'{row_id}/{photo_id}.jpg'
        destination = safe_path(store.photos, path)
        try:
            with store.write() as db:
                previous = db.execute('SELECT * FROM item_photos WHERE id=?', (photo_id,)).fetchone()
                if previous:
                    if previous['item_id'] != row_id:
                        raise HTTPException(409, 'Photo ID is already used by another item')
                    saved_path = safe_path(store.photos, previous['object_path'])
                    if not saved_path.is_file():
                        saved_path.parent.mkdir(parents=True, exist_ok=True)
                        saved_path.write_bytes(compressed)
                    return decode(previous)
                if not db.execute('SELECT 1 FROM items WHERE id=?', (row_id,)).fetchone():
                    raise HTTPException(404, 'Save the item before uploading photos')
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_suffix('.tmp')
                temporary.write_bytes(compressed)
                temporary.replace(destination)
                order = db.execute('SELECT coalesce(max(sort_order),-1)+1 FROM item_photos WHERE item_id=?', (row_id,)).fetchone()[0]
                db.execute('INSERT INTO item_photos(id,item_id,object_path,sort_order,is_cover,created_at) VALUES(?,?,?,?,?,?)', (photo_id, row_id, path, order, order == 0, now()))
                result = decode(db.execute('SELECT * FROM item_photos WHERE id=?', (photo_id,)).fetchone())
            return result
        except BaseException:
            # A known rollback removes the file; an interrupted process is reported by verify.
            with store.connect() as db:
                if not db.execute('SELECT 1 FROM item_photos WHERE id=?', (photo_id,)).fetchone():
                    destination.unlink(missing_ok=True)
            raise

    @app.get('/api/photos/file', dependencies=protected)
    def photo_file(path: str):
        with store.locked(), store.connect() as db:
            if not db.execute('SELECT 1 FROM item_photos WHERE object_path=?', (path,)).fetchone():
                raise HTTPException(404, 'Photo is unavailable')
            try:
                content = safe_path(store.photos, path).read_bytes()
            except (ValueError, FileNotFoundError):
                raise HTTPException(404, 'Photo file is missing; run the local verify command')
        try:
            with Image.open(io.BytesIO(content)) as image:
                media_type = Image.MIME.get(image.format, 'application/octet-stream')
        except OSError:
            raise HTTPException(409, 'Photo file is corrupt; run the local verify command')
        return Response(content, media_type=media_type)

    @app.delete('/api/photos/{photo_id}', dependencies=protected)
    def delete_photo(photo_id: str):
        warning = None
        with store.write() as db:
            row = db.execute('SELECT * FROM item_photos WHERE id=?', (photo_id,)).fetchone()
            if not row:
                return {'warning': None}
            db.execute('DELETE FROM item_photos WHERE id=?', (photo_id,))
            if row['is_cover']:
                db.execute('UPDATE item_photos SET is_cover=1 WHERE id=(SELECT id FROM item_photos WHERE item_id=? ORDER BY sort_order,id LIMIT 1)', (row['item_id'],))
            # Deleting metadata first avoids ever pointing at a deliberately removed file.
            db.commit()
            try:
                safe_path(store.photos, row['object_path']).unlink(missing_ok=True)
            except OSError:
                warning = f"Photo removed, but its unused file remains at {row['object_path']}. Run verify --cleanup."
        return {'warning': warning}

    @app.put('/api/items/{row_id}/photo-order', dependencies=protected)
    def photo_order(row_id: str, body: PhotoOrder):
        with store.write() as db:
            ids = {row['id'] for row in db.execute('SELECT id FROM item_photos WHERE item_id=?', (row_id,))}
            if set(body.ordered_photo_ids) != ids or len(body.ordered_photo_ids) != len(ids) or body.cover_photo_id not in ids:
                raise HTTPException(409, 'Photo list changed; reload and retry')
            for index, photo_id in enumerate(body.ordered_photo_ids):
                db.execute('UPDATE item_photos SET sort_order=?,is_cover=? WHERE id=?', (index, photo_id == body.cover_photo_id, photo_id))
        return {'ok': True}

    @app.get('/api/export', dependencies=protected)
    def export():
        with store.connect() as db:
            db.execute('BEGIN')
            return store.export(db)

    @app.get('/api/backup', dependencies=protected)
    def backup():
        from .maintenance import create_backup
        from starlette.background import BackgroundTask
        try:
            path = create_backup(store)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        return FileResponse(path, filename='lunas-storage-backup.zip', media_type='application/zip', background=BackgroundTask(path.unlink, missing_ok=True))

    @app.get('/api/health')
    def health():
        return {'ok': True, 'backend': 'local-sqlite'}

    @app.get('/{path:path}')
    def frontend_files(path: str):
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(404, 'Unknown API route')
        candidate = (build / path).resolve()
        if not candidate.is_relative_to(build) or path.startswith('.'):
            raise HTTPException(404)
        if candidate.is_file():
            return FileResponse(candidate)
        if Path(path).suffix:
            raise HTTPException(404)
        index = build / 'index.html'
        if not index.is_file():
            raise HTTPException(503, 'Frontend build is missing. Run setup.bat first.')
        return FileResponse(index, headers={'Cache-Control': 'no-cache'})

    return app
