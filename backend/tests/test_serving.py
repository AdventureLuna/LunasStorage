import re
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from backend.app import ROOT, create_app


def test_real_http_built_app_and_api_share_one_port_without_cloud(tmp_path):
    build = ROOT / 'dist'
    if not (build / 'index.html').exists():
        pytest.skip('Build the frontend before this integration test')
    app = create_app(tmp_path / 'http-data', build)
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level='error'))
    thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
    thread.start()
    try:
        for _ in range(200):
            if server.started:
                break
            time.sleep(.01)
        assert server.started
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', trust_env=False) as client:
            page = client.get('/')
            assert page.status_code == 200
            assert client.get('/item/a-direct-route').text == page.text
            assert client.get('/api/health').json()['backend'] == 'local-sqlite'
            assert client.get('/api/items').status_code == 401
            urls = re.findall(r'(?:src|href)="([^\"]+\.(?:js|css))"', page.text)
            assert urls
            for url in urls:
                assert url.startswith('/assets/')
                asset = client.get(url)
                assert asset.status_code == 200
                assert not any(marker in asset.text for marker in ('supabase.co', 'sb_publishable_', 'getUserMedia(', '/auth/v1', 'fonts.googleapis.com', 'fonts.gstatic.com'))
                assert not re.search(r'url\([\"\x27]?https?://', asset.text)
            headers = {'X-Inventory-Client': 'local', 'Origin': f'http://127.0.0.1:{port}'}
            result = client.post('/api/auth/setup', headers=headers, json={'username': 'offline-test', 'password': 'offline-password'})
            assert result.status_code == 200
            assert client.get('/api/items').json() == {'items': [], 'count': 0}
            assert client.get('/api/backup').status_code == 200
            assert "connect-src 'self'" in page.headers['content-security-policy']
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
        assert not thread.is_alive()
