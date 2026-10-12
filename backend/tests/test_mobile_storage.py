import io
import sqlite3
import uuid
from pathlib import Path

from PIL import Image

from backend.tests.test_local import env, HEADERS, inventory, upload  # noqa: F401
from backend.maintenance import create_backup, restore_backup
from backend.store import Store


def test_nested_summaries_loose_items_and_ancestor_search(env):
    _, client = env
    room, box, original = inventory(client)
    shelf = client.post('/api/locations', headers=HEADERS, json={'name': 'Middle shelf', 'parent_id': room['id'], 'icon': 'shelf', 'color': 'blue'}).json()
    client.put('/api/boxes/' + box['id'], headers=HEADERS, json={'location_id': shelf['id'], 'description': 'Box 10', 'expected_version': box['version']})
    client.post('/api/items', headers=HEADERS, json={'name': 'Loose torch', 'location_id': room['id'], 'quantity': 100})
    client.post('/api/items', headers=HEADERS, json={'name': 'Old set', 'box_id': box['id'], 'archived': True})
    summary = client.get('/api/storage-summary').json()
    assert summary['locations'][room['id']] == {'direct_boxes': 0, 'direct_items': 1, 'boxes': 1, 'items': 2, 'archived_items': 1}
    assert summary['boxes'][box['id']]['items'] == 1
    assert summary['totals']['items'] == 2
    assert client.get('/api/items', params={'search': 'Basement brackets'}).json()['items'][0]['id'] == original['id']
    assert client.get('/api/items', params={'location': room['id'], 'subtree': True}).json()['count'] == 2
    assert client.get('/api/items', params={'location': room['id'], 'loose': True, 'subtree': False}).json()['count'] == 1
    assert client.get('/api/items', params={'location': room['id'], 'subtree': False}).json()['count'] == 1
    assert shelf['icon'] == 'shelf' and shelf['color'] == 'blue'


def test_batch_creation_is_atomic_idempotent_and_preserves_parent(env):
    _, client = env
    room, _, _ = inventory(client)
    body = {'names': ['Upper shelf', 'Lower shelf'], 'parent_id': room['id'], 'request_id': str(uuid.uuid4()), 'icon': 'shelf', 'color': 'amber'}
    first = client.post('/api/locations/batch', json=body, headers=HEADERS)
    assert first.status_code == 200
    assert client.post('/api/locations/batch', json=body, headers=HEADERS).json() == first.json()
    assert len(client.get('/api/locations').json()) == 3
    assert all(row['parent_id'] == room['id'] and row['color'] == 'amber' for row in first.json())
    assert client.post('/api/locations/batch', json=dict(body, names=['Changed', 'Lower shelf']), headers=HEADERS).status_code == 409
    assert client.post('/api/locations/batch', json=dict(body, request_id=str(uuid.uuid4()), names=['Duplicate', 'duplicate']), headers=HEADERS).status_code == 422
    assert len(client.get('/api/locations').json()) == 3


def test_thumbnail_access_and_old_backup_upgrade(env, tmp_path):
    app, client = env
    _, _, item = inventory(client)
    content = io.BytesIO(); Image.new('RGB', (1500, 900), 'blue').save(content, 'JPEG')
    photo = upload(client, item, content.getvalue())
    result = client.get('/api/photos/file', params={'path': photo['object_path'], 'size': 128})
    assert result.status_code == 200
    with Image.open(io.BytesIO(result.content)) as image:
        assert image.size[0] == 128 and image.size[1] < 128
    assert client.get('/api/photos/file', params={'path': photo['object_path'], 'size': 128}).content == result.content
    store = app.state.store
    with store.write() as db:
        db.execute('ALTER TABLE locations DROP COLUMN icon')
        db.execute('ALTER TABLE locations DROP COLUMN color')
        db.execute('DELETE FROM schema_migrations WHERE version=2')
    backup = create_backup(store, tmp_path / 'old-schema.zip')
    restore_backup(backup, tmp_path / 'restored')
    restored = Store(tmp_path / 'restored')
    assert restored.rows('locations')[0]['icon'] == 'folder'
    assert restored.rows('items')[0]['id'] == item['id']
    client.post('/api/auth/logout', headers=HEADERS)
    assert client.get('/api/photos/file', params={'path': photo['object_path'], 'size': 128}).status_code == 401
