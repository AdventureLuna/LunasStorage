# LunasStorage — local Windows inventory

The existing React/TypeScript interface now runs entirely from your Windows PC. FastAPI serves the built frontend and `/api` on one port, SQLite holds the inventory, and a local folder holds photos. After setup and building, startup, login, editing, search, photos and backups require no internet. No Docker, Supabase server, router port forwarding or cloud hosting is needed. GitHub is used for source and CI only.

## Install and start

Install Python **3.11 or newer** (including the Windows `py` launcher) and Node.js **22 or newer**. Open this repository in PowerShell:

```powershell
.\setup.bat
.\start.bat
```

`setup.bat` needs internet once: it creates `.venv`, installs the Python requirements, runs `npm.cmd ci`, and builds `dist`. Run it again after updating source or dependencies. `start.bat` uses the existing virtual environment and build; it never installs packages or rebuilds. It listens on `0.0.0.0:8000` and prints the PC URL and likely LAN candidates. Only one server may use a given data directory.

Open **http://localhost:8000** on the PC and create your username and password. This is a single local account, shared by the PC and phone. First-run account creation is allowed only from the PC loopback connection, not from the LAN. There is no public registration. Passwords are hashed with scrypt; login uses expiring, HttpOnly server-side session cookies. Signing out revokes that session. API and photos require login.

Keep the terminal running. Stop with **Ctrl+C**; if Windows asks whether to terminate the batch job, choose **Y**. To start again, run `start.bat`. The PC must remain awake and connected to the network; configure Windows sleep settings accordingly.

Optional configuration, set before running the launcher:

```powershell
$env:INVENTORY_PORT = '8000'
$env:INVENTORY_DATA_DIR = 'D:\LunasStorageData'
.\start.bat
```

The default data directory is **`%LOCALAPPDATA%\LunasStorage`** (normally `C:\Users\julia\AppData\Local\LunasStorage`). Keep it outside this repository, `dist`, and cloud-synced folders. Environment variables can be made persistent through Windows **Edit environment variables for your account**; open a new terminal afterward. `.env.local` from the former Supabase setup is no longer used by the application. No frontend API URL or keys are needed.

## Open from your phone

1. Connect the phone to the same home Wi-Fi/network as the PC. A guest Wi-Fi that isolates devices will not work.
2. Run `start.bat`. On the phone, open a printed LAN candidate, such as **`http://192.168.1.25:8000`**, and sign in. Phone `localhost` means the phone itself, so use the PC address.
3. If multiple candidates are printed, use `ipconfig` on the PC and choose the IPv4 address of the Wi-Fi/Ethernet adapter on the phone's network. VPN/virtual adapter addresses may not work.
4. Set Windows network profile to **Private**. If Windows asks about Python network access, allow it on **Private networks**. Alternatively, add an inbound Windows Defender Firewall rule for TCP port 8000, **Private** profile, with remote scope **Local subnet**. If you change the port, update the rule. Do not disable the firewall.
5. Reserve that PC's IPv4 address for its network adapter in your router's **DHCP reservation/address reservation** settings. This keeps the bookmarked phone URL stable.

Ordinary LAN HTTP is intended for a **trusted home network**: passwords and traffic are not encrypted in transit. Do not expose the server on the internet or use port forwarding. Camera capture is a file input with `capture="environment"`; phones may open their native camera or a chooser depending on the browser. Gallery multi-selection remains available. There is no embedded preview that requires HTTPS. Use JPEG, PNG or WebP; convert unsupported HEIC/HEIF photos first.

## Your inventory

- **Inventory** is a photo-card catalog with search across names, notes, tags, box names/numbers and locations. Search words match together; quoted phrases are supported. Filters narrow by location, box, tag, archive state and out-of-stock quantity. An item has its own hash-route page with its photo gallery, notes, quantities, edit, move and archive controls. Refreshing a page works on the local server.
- **Storage** shows one location at a time with breadcrumbs. Locations can have parents. Open a box for Fill this box, View items, Edit or Delete. Nonempty locations/boxes must be emptied before deletion.
- Box numbers are allocated globally in a transaction and never reused after deletion. Custom box labels such as **Box 10** or **Christmas decorations** remain supported through the existing description field. Numbered identity and display name are distinct. Imported actual `box_number` values are preserved and advance the allocator.
- **Store in** remembers the last valid destination per account in that browser. **Save & add another** clears item fields while keeping the box selected.
- Multiple selected photos have previews and individual remove controls. Successful uploads stay saved if another fails. Stable client IDs make item creation and photo retries idempotent after uncertain network responses. Photos are validated and resized/oriented as JPEG by the backend as well as compressed by capable browsers.
- Unknown quantities remain null; zero means out of stock. Groups can be recorded as a single item with quantity/unit. Volume is an estimate for the whole entry. Archive/restore keeps photos and relationships.
- Version checks reject stale edits from the other device. Moves validate the entire selection and commit atomically. SQLite foreign keys are enabled on every connection, connections are short-lived per operation, and writes use transactions plus a cross-process file lock. SQLite runs in WAL mode.

## Data, backups and restore

The data folder contains `inventory.sqlite3`, its WAL/SHM files while active, `photos`, and lock files. Runtime data is not stored in source/build folders or committed to Git. Database migrations in `backend/migrations` are applied automatically, recorded with versions/checksums, and reject unsupported newer schemas.

**Settings → Full local backup** downloads a ZIP containing a consistent SQLite snapshot, every referenced photo, `inventory.json`, and a checksum/photo manifest. It uses SQLite's online backup API and freezes inventory/photo writes while taking the snapshot. It is safe while the server is running. Missing referenced files fail the backup instead of silently creating an incomplete one. Active sessions are excluded; the local password hash is included. Keep backups private and copy them to another disk periodically.

The same backup is available from PowerShell while the server is running:

```powershell
.\maintenance.bat backup "$env:USERPROFILE\Documents\LunasStorage-backup.zip"
.\maintenance.bat verify
```

Choose a new output filename each time. JSON/CSV downloads remain useful for review; JSON alone is not a full photo backup. Do not copy only `inventory.sqlite3` while the server is active, because WAL may contain newer data. With the server fully stopped, copying the complete data directory is also valid.

Restore a local ZIP into a **new empty directory** with the server stopped. Existing inventories are never overwritten:

```powershell
.\maintenance.bat --data-dir 'D:\LunasStorage-restored' restore "$env:USERPROFILE\Documents\LunasStorage-backup.zip"
$env:INVENTORY_DATA_DIR = 'D:\LunasStorage-restored'
.\start.bat
```

Restore validates checksums, SQLite integrity, foreign keys, inventory JSON equality and all photos before promoting the database. The original data folder remains available. A interrupted restore can be repeated with the same ZIP and destination. Log in with the backed-up local username/password; session cookies are not restored.

`maintenance.bat verify` reports record counts, integrity, missing photos and unused/orphan files. `verify --cleanup` removes only unreferenced photo files under the data directory. Do not use cleanup while an interrupted import is waiting to resume; the staged files are intentionally reused on retry.

Forgotten local password: stop the server, run **`maintenance.bat reset-password`**, enter the new password twice in the terminal, then restart. This preserves inventory and revokes all sessions. No email service is required.

## One-time migration from Supabase

The old schema/export format was inspected. IDs, box numbers, names/descriptions, quantities, tags, timestamps, versions, archive state, relations, source owner metadata, photo IDs/order/cover flags and actual photo bytes are preserved. Supabase data is **read only** and never deleted or modified. The historical SQL under `supabase/migrations` is retained as a reference; do not apply it for the local server.

**Preferred: use the existing full ZIP export.** Stop the local server and import into an empty local inventory (an already-created local login is fine):

```powershell
.\maintenance.bat import-zip 'C:\Users\julia\Downloads\storage-inventory-backup.zip'
.\maintenance.bat verify
.\start.bat
```

The ZIP needs `inventory.json`, `photo-manifest.json`, and every file at its manifest path under `photos/`. Records are committed as one transaction only after all photo files validate/copy successfully. Interruptions leave reusable staged files, not partial records. Retry with the same input; a completed import is recognized and not duplicated. Different imports refuse to merge into a populated inventory. Create your new local account at localhost if you imported before first-run setup.

The original ZIP did not export the numbering counter, so its importer starts above the highest retained box number. The direct Supabase downloader also reads the original counter, preserving numbers allocated to boxes that were later deleted. New local JSON exports include `next_box_number`, and local SQLite backups preserve the counter exactly.

**If no full ZIP is available, download records and photos from Supabase.** Pause edits to the old app during downloading. You need:

- the project base URL, e.g. `https://your-project.supabase.co`;
- your exporting account's UUID (`owner_id`, visible in Supabase Auth → Users);
- either a locally held service-role/secret key with read access, **or** the publishable/anon key plus a valid owner's access token in `MIGRATION_SUPABASE_TOKEN`.

These values are used only by the local migration utility. Enter them in the terminal environment; do not put privileged keys into the frontend, Git, or command-line arguments. Example:

```powershell
$env:MIGRATION_SUPABASE_URL = 'https://your-project.supabase.co'
$migrationKey = Read-Host 'Migration key' -AsSecureString
$env:MIGRATION_SUPABASE_KEY = [System.Net.NetworkCredential]::new('', $migrationKey).Password
.\maintenance.bat download-supabase --owner-id 'YOUR-ACCOUNT-UUID' --output 'D:\LunasMigration'
.\maintenance.bat import-json 'D:\LunasMigration\inventory.json' --photos-dir 'D:\LunasMigration'
.\maintenance.bat verify
Remove-Item Env:MIGRATION_SUPABASE_KEY
```

With a publishable key, also supply `MIGRATION_SUPABASE_TOKEN` securely and clear it afterward. The downloader paginates every table, freezes a local metadata snapshot, downloads private photo objects, records checksums, and writes `migration-report.json`. Retry the same output directory to resume missing photo downloads. It reuses checksum-verified files and checks whether the source records changed. If the source changed, pause edits and use a new download directory. Access errors and missing photos are reported; the importer refuses an incomplete archive. Internet is needed only for this one-time download.

A standalone JSON export also works with a matching `photo-manifest.json` and photo files in the directory given by `--photos-dir`. Remote URLs alone are not sufficient. If the old project is inaccessible, obtain a full ZIP or the credentials/account UUID described above; the tooling cannot recover photo bytes without one of those inputs.

## Development and checks

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
.\.venv\Scripts\python.exe -m pytest backend/tests -q
```

For frontend development run the local backend with `start.bat`, then `npm.cmd run dev` in another terminal. Vite proxies `/api` to `127.0.0.1:8000` (or the `INVENTORY_PORT` environment value). Production always serves frontend/API from the same port and uses relative `/api` URLs. `npm.cmd` avoids PowerShell's execution restriction on the npm.ps1 wrapper.

CI runs frontend checks/build and backend tests. Tests cover login/session protection, numbering under simultaneous requests, stale edits, search, moves, archiving, photos, SQLite migrations, resumable legacy imports and backup/restore. Automated local HTTP tests are distinct from trying the app on your physical phone; adapter choice, firewall, Wi-Fi isolation and native camera behavior require your actual LAN device.
