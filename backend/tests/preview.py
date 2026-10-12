"""Loopback-only visual test fixture. Not used by the production launcher.

Run python -m backend.tests.preview, inspect http://localhost:8765, Ctrl+C.
All data and a synthetic preauthenticated session live in a temporary directory.
"""
import secrets
import tempfile
import time
from pathlib import Path

import uvicorn
from PIL import Image, ImageDraw

from backend.app import create_app
from backend.security import password_hash, token_hash
from backend.store import new_id, now


def main():
    with tempfile.TemporaryDirectory(prefix='lunas-visual-test-') as directory:
        app = create_app(Path(directory))
        store = app.state.store
        location, child, box = new_id(), new_id(), new_id()
        token = secrets.token_urlsafe(32)
        with store.write() as db:
            db.execute('INSERT INTO account VALUES(1,?,?)', ('Visual test fixture', password_hash(secrets.token_urlsafe(24))))
            db.execute('INSERT INTO sessions VALUES(?,?)', (token_hash(token), time.time() + 3600))
            for row_id, name, parent in [(location, 'Basement', None), (child, 'Storage shelf', location)]:
                db.execute('INSERT INTO locations(id,name,parent_id,version,created_at,updated_at) VALUES(?,?,?,1,?,?)', (row_id, name, parent, now(), now()))
            db.execute('INSERT INTO boxes(id,box_number,location_id,description,version,created_at,updated_at) VALUES(?,10,?,?,1,?,?)', (box, child, 'Box 10', now(), now()))
            db.execute('UPDATE counters SET next_number=11')
            for name, color, tags in [('Shelf brackets', '#75977d', ['hardware']), ('Winter scarves', '#b19c84', ['clothes']), ('Ikea shelf accessories', '#9babb3', ['spares'])]:
                item, photo = new_id(), new_id()
                db.execute('INSERT INTO items(id,name,tags,quantity,quantity_unit,quantity_approximate,box_id,archived,version,created_at,updated_at) VALUES(?,?,?,4,?,0,?,0,1,?,?)', (item, name, __import__('json').dumps(tags), 'pieces', box, now(), now()))
                path = f'{item}/{photo}.jpg'
                destination = store.photos / path; destination.parent.mkdir()
                image = Image.new('RGB', (500, 500), color)
                ImageDraw.Draw(image).rounded_rectangle((110, 110, 390, 390), radius=32, fill='#e8ece4')
                image.save(destination, 'JPEG')
                db.execute('INSERT INTO item_photos(id,item_id,object_path,sort_order,is_cover,created_at) VALUES(?,?,?,0,1,?)', (photo, item, path, now()))
        @app.middleware('http')
        async def fixture_session(request, call_next):
            response = await call_next(request)
            if request.url.path == '/':
                response.set_cookie('inventory_session', token, httponly=True, samesite='strict')
            return response
        print('Visual fixture: http://localhost:8765 (temporary synthetic inventory only)', flush=True)
        uvicorn.run(app, host='127.0.0.1', port=8765, log_level='warning')


if __name__ == '__main__':
    main()
