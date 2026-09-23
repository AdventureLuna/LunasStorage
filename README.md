# LunasStorage

Private, mobile-friendly home inventory.
React, TypeScript and Vite serve the static app; Supabase Auth, Postgres RLS and private Storage hold the live inventory. No privileged key or always-running backend is used by the browser.

## Run locally

1. Create a free Supabase project.
2. Apply the migration SQL itself. In this repository, open `supabase/migrations/202609230001_initial.sql`, copy the entire file contents, paste that SQL into a new Supabase **SQL Editor** query, and click **Run**. Do not paste the filename/path as the query. Use this SQL Editor method for the current setup; the repository is not initialized for Supabase CLI migrations. This creates the tables, owner policies, private photo bucket, number allocator and atomic move RPC. If the editor reports success, continue to the next step without running the migration again.
3. In **Authentication → Users**, create your Luna account. Then go to **Authentication → General configuration** and turn off **Allow new users to sign up**. Configure the Email provider and password recovery email as needed. The app has no registration screen; with signups disabled, only the account you created can sign in.
4. In the repository folder, copy `.env.example` to `.env.local` (PowerShell: `Copy-Item .env.example .env.local`), then open `.env.local` in your editor. Set `VITE_SUPABASE_URL` to the project base, such as `https://your-project-ref.supabase.co`, and `VITE_SUPABASE_PUBLISHABLE_KEY` to the `sb_publishable_…` key. Do not append `/rest/v1` to the URL; that is the REST endpoint path, not the Supabase client base URL. The publishable key is designed for browsers and is safe to ship because database and Storage RLS enforce access. Never use a `service_role` or secret key here.
5. Install dependencies and start the app. In Windows PowerShell, use `npm.cmd install` followed by `npm.cmd run dev`; `npm.cmd` avoids PowerShell's script-execution restriction on the `npm.ps1` wrapper. In other terminals, use `npm install` followed by `npm run dev`. Open the printed local URL.

The app shows a configuration-required screen until both variables are present. Login is email/password; recovery uses Supabase email recovery. Under **Authentication → URL Configuration**, set the Site URL to `https://adventureluna.github.io/LunasStorage/` and add `http://localhost:5173/**` plus `https://adventureluna.github.io/LunasStorage/**` to Redirect URLs. Recovery returns to the application hash route.

## Deploy on GitHub Pages

The target repository is [AdventureLuna/LunasStorage](https://github.com/AdventureLuna/LunasStorage). Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The included workflow builds with `/LunasStorage/` as Vite's base for project Pages and deploys on pushes to `main`. In **Settings → Secrets and variables → Actions → Variables**, add `VITE_SUPABASE_URL` (the project base URL) and `VITE_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_…` key). These are browser-visible public values, not secrets; never add a Supabase secret key. Saving repository variables and pushing to `main` starts a fresh build. For a user/organization root Pages site, adjust `vite.config.ts` base to `/`.

Database migrations are applied separately to Supabase; deploying the static frontend does not apply SQL. The included check workflow runs typecheck, lint, tests and build.

## Data and privacy notes

Inventory, locations, boxes and photo metadata are owner-scoped using RLS. Storage is private; object paths are stored in Postgres and the client requests short-lived signed image URLs as needed. Two migration functions use `SECURITY DEFINER`: the box-number trigger (fixed search path, checks `auth.uid()` against the row owner, no direct execute grant) and the restore RPC (fixed search path, requires an authenticated caller, locks and checks that caller's inventory is empty, remaps owner IDs, validates staged photo ownership, and is executable only by `authenticated`). The restore-only transaction flag is set inside that RPC. Other data functions use invoker security. Location cycles and cross-owner references are constrained in Postgres. Box contents use a foreign key relationship, so changing a box's location changes the displayed address without rewriting its items.

Box capacity is descriptive only. `volume_l` is an estimate for the entire entry, never per-piece multiplication or a geometric fit calculation. Null quantity means unknown; zero means out of stock. Archiving retains photos.

Photo capture and gallery selection are separate controls. JPEG, PNG and WebP images are re-encoded as JPEG, orientation-corrected and resized to at most 2048 pixels on the long edge; HEIC/HEIF is rejected with a format error when the browser cannot decode it. If a network response leaves upload status uncertain, the error includes the private object path to check in Supabase Storage before retrying. Metadata registration failures trigger immediate object cleanup; if cleanup also fails, remove the reported path from the `inventory-photos` bucket after signing in to the Supabase dashboard.

## Backup, exports and restore

Settings exports versioned JSON, flattened CSV, and a full ZIP containing JSON, a schema note, and photo files at their relative private paths. ZIP creation reports progress and aborts without claiming completion if any photo fails. Photo files are fetched sequentially and streamed into the ZIP. Browsers with the File System Access API write directly to the save destination; other browsers use an in-memory ZIP fallback, which can run out of memory for very large backups. Exports can contain sensitive home inventory; keep them private. JSON is suitable to share with Codex for inventory review; share the ZIP if photo inspection is needed. Apply suggested edits manually in the app.

See [export schema](docs/export-schema.md). Restore only into an **empty** inventory with the included local utility. Apply the migration first, set the same browser-safe Supabase variables in `.env.local`, then run `npm run restore -- storage-inventory-backup.zip`. The tool validates JSON relationships, location cycles, box numbers, the photo manifest, JPEG files and paths before sign-in. It asks for your email and reads your password without echoing it. It checks all four target tables are empty, remaps ownership and photo paths to the signed-in account, uploads photos, and calls the owner-scoped restore RPC. The RPC refuses populated inventories, preserves UUIDs and box numbers, rejects reuse of numbers already allocated on the target, advances the counter, and commits records atomically. It does not use a service or secret key. If the database restore fails, uploaded objects are removed where the response confirms rollback; if the request outcome is ambiguous or cleanup fails, the tool reports the owner paths for manual reconciliation. Do a trial restore in a separate disposable Supabase project before relying on a backup.

## Phone smoke test

Open the deployed URL on a phone after configuring Supabase. Sign in, add a location named “Basement shelf,” create Boxes 1 and 2, add “Ikea shelf accessories” with two photos, then search for it. Move it to Box 2 and move Box 2 to a second location; the address should follow. Add an item with only name and location, archive and restore one item, and download a ZIP backup.

## Current scope and backlog

Core list/add/edit basics, locations, numbered boxes, upload retries, photo viewing/reorder/cover/removal, archive, atomic selected movement, server-side search, box contents/quick add, per-box estimated volume and missing-estimate counts, item detail with photo gallery and move/archive actions, and authenticated restore are in the first pass. Backlog: scheduled backup, movement history, swipe decluttering, stock splitting and direct Codex integration. The live restore round-trip, RLS/API checks and phone workflow require a disposable Supabase project and test account.

## Commands

```sh
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```
