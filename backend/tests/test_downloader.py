import io
import json
import uuid
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

import pytest
from PIL import Image

from backend.maintenance import download_supabase, import_archive
from backend.store import Store


def test_read_only_download_resume_and_import(monkeypatch, tmp_path):
    owner, location, item, photo1, photo2 = [str(uuid.uuid4()) for _ in range(5)]
    records = {
        'locations': [{'id': location, 'owner_id': owner, 'name': 'Room', 'parent_id': None, 'version': 3}],
        'boxes': [],
        'items': [{'id': item, 'owner_id': owner, 'name': 'Hardware', 'location_id': location, 'box_id': None, 'tags': [], 'quantity': None, 'volume_l': None, 'quantity_unit': None, 'quantity_approximate': False, 'notes': None, 'archived': False, 'archived_at': None, 'version': 4}],
        'item_photos': [{'id': photo, 'owner_id': owner, 'item_id': item, 'object_path': f'{owner}/{item}/{photo}.jpg', 'sort_order': index, 'is_cover': index == 0} for index, photo in enumerate([photo1, photo2])],
    }
    content = io.BytesIO(); Image.new('RGB', (5, 5)).save(content, 'JPEG')
    calls = []
    fail_second = True
    def remote(request, timeout):
        nonlocal fail_second
        assert request.get_method() == 'GET'
        assert timeout == 60
        parsed = urlparse(request.full_url)
        calls.append(parsed.path)
        if parsed.path.startswith('/rest/v1/'):
            query = parse_qs(parsed.query)
            assert query['owner_id'] == ['eq.' + owner]
            if parsed.path.endswith('/box_number_counters'):
                return io.BytesIO(b'[{"next_number":15}]')
            assert query['order'] == ['id.asc']
            return io.BytesIO(json.dumps(records[parsed.path.split('/')[-1]]).encode())
        if photo2 in parsed.path and fail_second:
            raise HTTPError(request.full_url, 404, 'missing', {}, None)
        return io.BytesIO(content.getvalue())
    monkeypatch.setenv('MIGRATION_SUPABASE_URL', 'https://example.supabase.co')
    monkeypatch.setenv('MIGRATION_SUPABASE_KEY', 'local-utility-only-test-key')
    monkeypatch.setattr('backend.maintenance.urlopen', remote)
    directory = tmp_path / 'download'
    with pytest.raises(ValueError, match='incomplete'):
        download_supabase(directory, owner)
    report = json.loads((directory / 'migration-report.json').read_text())
    assert report['missing_photos'][0]['photo_id'] == photo2
    first_downloads = sum(photo1 in path for path in calls)
    fail_second = False
    assert download_supabase(directory, owner)['missing_photos'] == []
    assert sum(photo1 in path for path in calls) == first_downloads
    report = import_archive(Store(tmp_path / 'import'), json.loads((directory / 'inventory.json').read_text()), json.loads((directory / 'photo-manifest.json').read_text()), lambda entry: (directory / entry['archive_path']).read_bytes())
    assert report['photos_copied'] == 2
    assert 'local-utility-only-test-key' not in (directory / 'migration-report.json').read_text()
