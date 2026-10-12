# Export and local backup formats

The review/export JSON remains `schema: home-storage-inventory`, `version: 1`, ISO `exported_at`, and four arrays in `data`: `locations`, `boxes`, `items`, and `item_photos`. UUIDs and relationships remain stable. Photo records include `object_path`, `sort_order` and `is_cover`; URLs are never stored. Source owner IDs are retained as migration metadata but no longer select a cloud account. Box display names remain in `description`, while global `box_number` allocation is internal and transaction-safe.

New exports also include `next_box_number` so imports preserve the allocator even when higher-numbered boxes were deleted. Historical JSON without that field starts above the largest retained box number. The direct downloader obtains the original Supabase counter.

CSV is a flattened human-readable item list, not a restore format. Unknown quantity/volume fields remain null in JSON. Archived items and photos are included in all full exports/backups.

The local full ZIP has:

- `inventory.sqlite3`: SQLite online snapshot including the single local account password hash, migration versions and numbering counter; sessions are cleared.
- `inventory.json`: the inventory in the compatible review format.
- `photo-manifest.json`: photo IDs, object paths, ZIP archive paths and SHA-256 checksums.
- `photos/<object_path>`: validated image bytes.
- `local-backup.json`: format `lunas-local-backup`, version 1, database checksum and backup time.

`maintenance.bat restore` verifies the local ZIP, database/JSON consistency, foreign keys, SQLite integrity and photo checksums and restores into a fresh data directory. Existing data is never overwritten. Account password hashes are portable; sessions are not.

`maintenance.bat import-zip` accepts the historical Supabase ZIP (`inventory.json`, `photo-manifest.json`, actual `photos/` files), as well as the inventory portion of a local ZIP. It preserves record IDs, versions, timestamps, original owner metadata, box numbers and photo order/cover flags; the local login is created separately. It does not upload anything to Supabase. Imported photos retain safe original object paths on disk. Interrupted imports can resume the same input, and completed imports are recognized by a fingerprint.

`maintenance.bat import-json` needs an equivalent manifest and local photo files supplied through `--photos-dir`. JSON-only and remote-photo-URL archives are insufficient. Every manifest path is checked against traversal/absolute paths and actual image bytes before the inventory transaction commits.
