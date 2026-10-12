import uuid
from pathlib import Path

from backend.tests.test_local import env, HEADERS, inventory, upload  # noqa: F401


def test_bulk_delete_removes_selected_records_and_photos_but_preserves_others(env):
    app, client = env
    location, box, first = inventory(client)
    second = client.post('/api/items', headers=HEADERS, json={'name': 'Delete this too', 'box_id': box['id']}).json()
    survivor = client.post('/api/items', headers=HEADERS, json={'name': 'Keep this', 'location_id': location['id']}).json()
    photos = [upload(client, first), upload(client, second), upload(client, survivor)]
    client.post(f"/api/items/{second['id']}/archive", headers=HEADERS, json={'archived': True, 'expected_version': second['version']})
    second = client.get(f"/api/items/{second['id']}").json()
    response = client.post('/api/items/delete', headers=HEADERS, json={'items': [{'id': item['id'], 'version': item['version']} for item in [first, second]]})
    assert response.status_code == 200, response.text
    assert response.json() == {'deleted': 2, 'photo_cleanup_failures': []}
    assert client.get(f"/api/items/{first['id']}").status_code == 404
    assert client.get(f"/api/items/{second['id']}").status_code == 404
    assert client.get(f"/api/items/{survivor['id']}").status_code == 200
    assert not (app.state.store.photos / photos[0]['object_path']).exists()
    assert not (app.state.store.photos / photos[1]['object_path']).exists()
    assert (app.state.store.photos / photos[2]['object_path']).exists()
    assert app.state.store.verify()['missing_photos'] == []
    assert client.get('/api/boxes').json()[0]['id'] == box['id']


def test_bulk_delete_is_protected_and_rejects_missing_stale_or_duplicate_selections(env):
    app, client = env
    _, box, first = inventory(client)
    second = client.post('/api/items', headers=HEADERS, json={'name': 'Second', 'box_id': box['id']}).json()
    photo = upload(client, first)
    client.put(f"/api/items/{second['id']}", headers=HEADERS, json={'name': 'Changed elsewhere', 'box_id': box['id'], 'expected_version': 1})
    first_entry = {'id': first['id'], 'version': first['version']}
    for entries, code in [
        ([first_entry, {'id': second['id'], 'version': 1}], 409),
        ([first_entry, {'id': str(uuid.uuid4()), 'version': 1}], 404),
        ([first_entry, first_entry], 422),
    ]:
        assert client.post('/api/items/delete', headers=HEADERS, json={'items': entries}).status_code == code
        assert client.get('/api/items').json()['count'] == 2
        assert (app.state.store.photos / photo['object_path']).exists()
    client.post('/api/auth/logout', headers=HEADERS)
    assert client.post('/api/items/delete', headers=HEADERS, json={'items': [first_entry]}).status_code == 401


def test_photo_cleanup_failures_are_reported_after_atomic_item_deletion(env, monkeypatch):
    app, client = env
    _, _, item = inventory(client)
    photo = upload(client, item)
    blocked = app.state.store.photos / photo['object_path']
    real_unlink = Path.unlink
    def fail_one(path, *args, **kwargs):
        if path == blocked:
            raise PermissionError('File locked')
        return real_unlink(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'unlink', fail_one)
    result = client.post('/api/items/delete', headers=HEADERS, json={'items': [{'id': item['id'], 'version': item['version']}]})
    assert result.status_code == 200
    assert result.json()['photo_cleanup_failures'] == [photo['object_path']]
    assert client.get('/api/items').json()['count'] == 0
    assert app.state.store.rows('item_photos') == []
    assert Path(photo['object_path']) in map(Path, app.state.store.verify()['orphan_files'])
