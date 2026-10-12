from __future__ import annotations

import argparse
import getpass
import json
import os
import socket
import sys
from pathlib import Path

from .maintenance import create_backup, download_supabase, import_archive, import_zip, restore_backup, stopped
from .security import password_hash
from .store import Store, default_data_dir, safe_path


def main():
    parser = argparse.ArgumentParser(description='LunasStorage local server and maintenance')
    parser.add_argument('--data-dir', type=Path, default=default_data_dir())
    commands = parser.add_subparsers(dest='command', required=True)
    run = commands.add_parser('serve')
    run.add_argument('--port', type=int, default=int(os.environ.get('INVENTORY_PORT', '8000')))
    commands.add_parser('reset-password')
    verify = commands.add_parser('verify'); verify.add_argument('--cleanup', action='store_true')
    backup = commands.add_parser('backup'); backup.add_argument('output', type=Path)
    restore = commands.add_parser('restore'); restore.add_argument('input', type=Path)
    legacy_zip = commands.add_parser('import-zip'); legacy_zip.add_argument('input', type=Path)
    legacy_json = commands.add_parser('import-json'); legacy_json.add_argument('input', type=Path); legacy_json.add_argument('--photos-dir', type=Path, required=True)
    remote = commands.add_parser('download-supabase'); remote.add_argument('--owner-id', required=True); remote.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    directory = args.data_dir.expanduser().resolve()
    if args.command == 'serve':
        import uvicorn
        from .app import create_app
        if not 1 <= args.port <= 65535:
            raise ValueError('Port must be between 1 and 65535')
        build = Path(__file__).resolve().parent.parent / 'dist' / 'index.html'
        if not build.is_file():
            raise ValueError('Frontend build missing. Run setup.bat first.')
        with stopped(directory):
            app = create_app(directory)
            print(f'PC URL: http://localhost:{args.port}\nData: {directory}', flush=True)
            candidates = {'127.0.0.1'}
            try:
                candidates.update(socket.gethostbyname_ex(socket.gethostname())[2])
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                    # UDP connect chooses the adapter; it sends no packets and needs no internet.
                    probe.connect(('192.0.2.1', 80)); candidates.add(probe.getsockname()[0])
            except OSError:
                pass
            for address in sorted(candidates - {'127.0.0.1', '0.0.0.0'}):
                print(f'LAN candidate: http://{address}:{args.port} (choose the adapter shared with your phone)', flush=True)
            print('Use ipconfig if your LAN address is not listed. Stop with Ctrl+C. Keep this PC awake.', flush=True)
            uvicorn.run(app, host='0.0.0.0', port=args.port, proxy_headers=False, workers=1)
        return
    if args.command == 'restore':
        result = restore_backup(args.input, directory)
    elif args.command == 'download-supabase':
        result = download_supabase(args.output, args.owner_id)
    elif args.command in ('import-zip', 'import-json', 'reset-password'):
        with stopped(directory):
            store = Store(directory)
            if args.command == 'import-zip':
                result = import_zip(store, args.input)
            elif args.command == 'import-json':
                manifest = json.loads((args.photos_dir / 'photo-manifest.json').read_text(encoding='utf-8'))
                result = import_archive(store, json.loads(args.input.read_text(encoding='utf-8')), manifest, lambda entry: safe_path(args.photos_dir, entry['archive_path']).read_bytes())
            else:
                password = getpass.getpass('New local password (8+ characters): ')
                if len(password) < 8 or password != getpass.getpass('Repeat password: '):
                    raise ValueError('Passwords must match and contain at least 8 characters')
                with store.write() as db:
                    if not db.execute('SELECT 1 FROM account').fetchone():
                        raise ValueError('Create the account in the app on localhost first')
                    db.execute('UPDATE account SET password_hash=?', (password_hash(password),))
                    db.execute('DELETE FROM sessions'); db.execute('DELETE FROM login_attempts')
                result = {'password_reset': True, 'sessions_revoked': True}
    else:
        store = Store(directory)
        if args.command == 'backup':
            result = {'backup': str(create_backup(store, args.output))}
        else:
            if args.cleanup:
                with store.locked(), store.connect() as db:
                    known = {safe_path(store.photos, row[0]) for row in db.execute('SELECT object_path FROM item_photos')}
                    for path in store.photos.rglob('*'):
                        if path.is_file() and path.resolve() not in known:
                            path.unlink()
            result = store.verify()
    print(json.dumps(result, indent=2))
    if args.command == 'verify' and (result['integrity'] != 'ok' or result['missing_photos'] or result['corrupt_photos'] or result['foreign_key_errors']):
        raise ValueError('Verification found missing or invalid data; see the report above')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Cannot complete operation: {error}', file=sys.stderr)
        sys.exit(1)
