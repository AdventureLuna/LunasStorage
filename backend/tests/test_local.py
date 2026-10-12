import io
import json
import sqlite3
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app import create_app
from backend.maintenance import create_backup, import_archive, import_zip, restore_backup, stopped
from backend.store import Store, safe_path

HEADERS = {'X-Inventory-Client': 'local'}


def photo_bytes():
    content = io.BytesIO()
    Image.new('RGB', (32, 20), 'red').save(content, 'JPEG')
    return content.getvalue()


@pytest.fixture
def env(tmp_path):
    build = tmp_path / 'dist'; build.mkdir()
    (build / 'index.html').write_text('<html>offline inventory</html>')
    (build / 'app.js').write_text('const api="/api";')
    app = create_app(tmp_path / 'data', build)
    with TestClient(app, client=('127.0.0.1', 50000)) as client:
        yield app, client


def setup(client):
    response = client.post('/api/auth/setup', headers=HEADERS, json={'username': 'Luna', 'password': 'test-password'})
    assert response.status_code == 200, response.text


def inventory(client):
    setup(client)
    location = client.post('/api/locations', headers=HEADERS, json={'name': 'Basement'}).json()
    box = client.post('/api/boxes', headers=HEADERS, json={'location_id': location['id'], 'description': 'Box 10'}).json()
    item = client.post('/api/items', headers=HEADERS, json={'id': str(uuid.uuid4()), 'name': 'Shelf brackets', 'notes': 'Äpfel spare parts', 'tags': ['hardware'], 'box_id': box['id'], 'quantity': 4, 'volume_l': 2}).json()
    assert item.get('version') == 1, item
    return location, box, item


def upload(client, item, content=None, photo_id=None):
    response = client.post(f"/api/items/{item['id']}/photos", params={'photo_id': photo_id or str(uuid.uuid4())}, files={'file': ('../../evil.jpg', content or photo_bytes(), 'image/jpeg')}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def test_single_user_login_origin_sessions_and_static_routes(env):
    app, client = env
    assert client.get('/api/locations').status_code == 401
    assert client.get('/api/photos/file?path=../../secret').status_code == 401
    assert client.get('/api/auth/status').json()['setup_required']
    assert client.get('/').text == '<html>offline inventory</html>'
    assert client.get('/items/some-id').status_code == 200
    assert client.get('/api/not-real').status_code == 404
    assert client.get('/missing.js').status_code == 404
    with TestClient(app, client=('192.168.1.3', 50000)) as remote:
        assert remote.post('/api/auth/setup', json={'username': 'Luna', 'password': 'test-password'}, headers=HEADERS).status_code == 403
    setup(client)
    assert client.post('/api/auth/setup', json={'username': 'Other', 'password': 'test-password'}, headers=HEADERS).status_code == 409
    assert client.post('/api/locations', json={'name': 'bad'}, headers=dict(HEADERS, Origin='http://evil.example')).status_code == 403
    assert client.post('/api/locations', json={'name': 'bad'}).status_code == 403
    with app.state.store.connect() as db:
        assert db.execute('SELECT password_hash FROM account').fetchone()[0].startswith('scrypt:')
        assert 'test-password' not in db.execute('SELECT password_hash FROM account').fetchone()[0]
    cookie = client.cookies.get('inventory_session')
    assert 'HttpOnly' in client.post('/api/auth/login', json={'username': 'Luna', 'password': 'test-password'}, headers=HEADERS).headers['set-cookie']
    client.post('/api/auth/logout', headers=HEADERS)
    assert client.get('/api/items').status_code == 401
    assert client.post('/api/auth/login', json={'username': 'Luna', 'password': 'bad'}, headers=HEADERS).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'Luna', 'password': 'test-password'}, headers=HEADERS).status_code == 200
    assert cookie


def test_items_search_stale_edits_cycles_moves_archive(env):
    app, client = env
    location, box, item = inventory(client)
    for query in ['bracket', 'hardware', 'spare', 'äPFEL', 'Box 10', 'Basement', '"Shelf brackets"']:
        response = client.get('/api/items', params={'search': query})
        assert response.status_code == 200, response.text
        assert response.json()['count'] == 1, query
    assert client.get('/api/items', params={'tag': 'hardware', 'box': box['id']}).json()['count'] == 1
    assert client.get('/api/items', params={'out': 'true'}).json()['count'] == 0
    body = {'id': item['id'], 'name': 'Changed', 'location_id': location['id'], 'expected_version': 1}
    saved = client.put(f"/api/items/{item['id']}", json=body, headers=HEADERS).json()
    assert saved['version'] == 2
    assert client.put(f"/api/items/{item['id']}", json=body, headers=HEADERS).status_code == 409
    assert client.post('/api/moves', headers=HEADERS, json={'item_ids': [item['id'], str(uuid.uuid4())], 'destination_id': box['id'], 'destination_type': 'box'}).status_code == 409
    assert client.get(f"/api/items/{item['id']}").json()['location_id'] == location['id']
    assert client.post('/api/moves', headers=HEADERS, json={'item_ids': [item['id']], 'destination_id': box['id'], 'destination_type': 'box'}).json()['moved'] == 1
    saved = client.get(f"/api/items/{item['id']}").json()
    result = client.post(f"/api/items/{item['id']}/archive", headers=HEADERS, json={'archived': True, 'expected_version': saved['version']}).json()
    assert client.get('/api/items').json()['count'] == 0
    assert client.get('/api/items?archived=true').json()['count'] == 1
    client.post(f"/api/items/{item['id']}/archive", headers=HEADERS, json={'archived': False, 'expected_version': result['version']})
    assert client.get('/api/items').json()['count'] == 1
    child = client.post('/api/locations', json={'name': 'Shelf', 'parent_id': location['id']}, headers=HEADERS).json()
    assert client.put('/api/locations/' + location['id'], json={'name': 'Basement', 'parent_id': child['id'], 'expected_version': 1}, headers=HEADERS).status_code == 409
    assert client.delete('/api/boxes/' + box['id'], params={'version': 1}, headers=HEADERS).status_code == 409
    assert client.delete('/api/locations/' + location['id'], params={'version': 1}, headers=HEADERS).status_code == 409


def test_concurrent_numbering_idempotent_items_and_photos(env):
    app, client = env
    location, box, item = inventory(client)
    cookies = dict(client.cookies)
    def create(_):
        with TestClient(app, client=('127.0.0.1', 50001)) as other:
            other.cookies.update(cookies)
            result = other.post('/api/boxes', json={'location_id': location['id']}, headers=HEADERS)
            assert result.status_code == 200, result.text
            return result.json()['box_number']
    with ThreadPoolExecutor(max_workers=6) as pool:
        numbers = list(pool.map(create, range(12)))
    assert sorted(numbers) == list(range(2, 14))
    assert client.post('/api/items', headers=HEADERS, json={'id': item['id'], 'name': item['name'], 'box_id': box['id']}).json()['id'] == item['id']
    assert client.get('/api/items').json()['count'] == 1
    one = upload(client, item); two = upload(client, item)
    assert [one['sort_order'], two['sort_order']] == [0, 1]
    assert upload(client, item, photo_id=one['id'])['id'] == one['id']
    assert len(client.get(f"/api/items/{item['id']}").json()['item_photos']) == 2
    assert client.get('/api/photos/file', params={'path': one['object_path']}).headers['content-type'] == 'image/jpeg'
    result = client.post(f"/api/items/{item['id']}/photos", params={'photo_id': str(uuid.uuid4())}, files={'file': ('x.jpg', b'not an image')}, headers=HEADERS)
    assert result.status_code == 422
    assert client.put(f"/api/items/{item['id']}/photo-order", json={'ordered_photo_ids': [two['id'], one['id']], 'cover_photo_id': two['id']}, headers=HEADERS).status_code == 200
    photos = client.get(f"/api/items/{item['id']}").json()['item_photos']
    assert photos[0]['id'] == two['id'] and photos[0]['is_cover']
    client.delete('/api/photos/' + two['id'], headers=HEADERS)
    assert not safe_path(app.state.store.photos, two['object_path']).exists()
    assert app.state.store.verify()['missing_photos'] == []
    assert client.get('/api/photos/file', params={'path': '../inventory.sqlite3'}).status_code == 404


def test_online_backup_restore_and_missing_photo_failure(env, tmp_path):
    app, client = env
    _, _, item = inventory(client)
    photo = upload(client, item)
    backup = tmp_path / 'backup.zip'
    create_backup(app.state.store, backup)
    target = tmp_path / 'restored'
    result = restore_backup(backup, target)
    assert result['integrity'] == 'ok' and result['missing_photos'] == []
    restored = Store(target)
    with restored.connect() as db:
        assert restored.export(db)['data'] == client.get('/api/export').json()['data']
        assert db.execute('SELECT count(*) FROM sessions').fetchone()[0] == 0
    with TestClient(create_app(target), client=('127.0.0.1', 50000)) as other:
        assert other.get('/api/items').status_code == 401
        assert other.post('/api/auth/login', headers=HEADERS, json={'username': 'Luna', 'password': 'test-password'}).status_code == 200
        assert other.get('/api/photos/file', params={'path': photo['object_path']}).status_code == 200
    response = client.get('/api/backup')
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as zipped:
        assert 'inventory.sqlite3' in zipped.namelist()
    safe_path(app.state.store.photos, photo['object_path']).unlink()
    with pytest.raises(ValueError, match='missing photo'):
        create_backup(app.state.store, tmp_path / 'bad.zip')
    assert not (tmp_path / 'bad.zip').exists()


def test_resumable_legacy_migration_preserves_ids_numbers_and_photo_order(env, tmp_path):
    _, client = env
    _, _, item = inventory(client)
    one = upload(client, item); two = upload(client, item)
    archive = client.get('/api/export').json()
    archive['data']['boxes'][0]['box_number'] = 10
    archive['next_box_number'] = 11
    archive['data']['items'][0]['version'] = 7
    owner = str(uuid.uuid4())
    for table, rows in archive['data'].items():
        for row in rows:
            row['owner_id'] = owner
            if table == 'item_photos':
                row['object_path'] = f"{owner}/{item['id']}/{row['id']}.jpg"
    manifest = [{'id': row['id'], 'object_path': row['object_path'], 'archive_path': 'photos/' + row['object_path']} for row in archive['data']['item_photos']]
    store = Store(tmp_path / 'imported')
    def interrupted(entry):
        if entry['id'] == two['id']:
            raise FileNotFoundError('Missing second photo')
        return photo_bytes()
    with pytest.raises(FileNotFoundError):
        import_archive(store, archive, manifest, interrupted)
    assert store.rows('items') == []
    imported = import_archive(store, archive, manifest, lambda _: photo_bytes())
    assert imported['photos_copied'] == 2
    assert store.rows('items')[0]['id'] == item['id'] and store.rows('items')[0]['version'] == 7
    assert store.rows('boxes')[0]['box_number'] == 10
    assert sorted((p['id'], p['sort_order']) for p in store.rows('item_photos')) == sorted([(one['id'], 0), (two['id'], 1)])
    assert import_archive(store, archive, manifest, lambda _: photo_bytes())['already_imported']
    assert store.verify()['missing_photos'] == []
    with store.connect() as db:
        assert db.execute('SELECT next_number FROM counters').fetchone()[0] == 11
    source = tmp_path / 'legacy.zip'
    with zipfile.ZipFile(source, 'w') as zipped:
        zipped.writestr('inventory.json', json.dumps(archive))
        zipped.writestr('photo-manifest.json', json.dumps(manifest))
        for entry in manifest:
            zipped.writestr(entry['archive_path'], photo_bytes())
    assert import_zip(Store(tmp_path / 'imported-zip'), source)['photos_copied'] == 2
    with stopped(store.root):
        from filelock import Timeout
        with pytest.raises(Timeout):
            with stopped(store.root):
                pass


def test_schema_migrations_foreign_keys_and_paths(tmp_path, monkeypatch):
    from backend.store import default_data_dir
    project = tmp_path / 'project'
    monkeypatch.setattr('backend.store.PROJECT_ROOT', project)
    monkeypatch.delenv('INVENTORY_DATA_DIR', raising=False)
    assert default_data_dir() == project / 'data'
    local = Store(default_data_dir())
    assert local.database == project / 'data' / 'inventory.sqlite3'
    for forbidden in [project, project / 'dist', project / 'src', project / 'backend']:
        with pytest.raises(ValueError, match='project data folder'):
            Store(forbidden)
    store = Store(tmp_path / 'data')
    Store(store.root)
    with store.connect() as db:
        assert db.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM schema_migrations').fetchone()[0] == 1
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO boxes VALUES('x',NULL,1,'missing',NULL,NULL,1,'now','now')")
    for path in ['../secret', '/absolute', 'C:/secret', 'nested\\secret', 'a//b', 'a/CON.jpg', 'a/trailing.']:
        with pytest.raises(ValueError):
            safe_path(store.photos, path)
