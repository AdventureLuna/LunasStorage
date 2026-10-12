# Using the redesigned LunasStorage interface

## Start the update

The frontend is built in this project. Stop the existing server with Ctrl+C and start it again using `start.bat`, then refresh the page on your phone. The restart loads the storage-summary, subtree-search, batch-creation and thumbnail endpoints. The location appearance migration runs automatically; existing IDs, box numbers, items and photos are retained.

A consistent backup from before the redesign is in `data/before-mobile-redesign-*.zip`. The data directory remains `A:\Codin\LunasStorage\data` when running this installation.

## Navigation

On mobile, use the bottom bar for **Items**, **Locations**, and **More**. The floating creation button follows your current screen. The header menu opens the secondary drawer, which can be closed with its button or a left swipe. Desktop uses a side navigation panel.

Locations and boxes have their own routes, so refresh and navigation retain the place being explored. Back from an item returns to the previous catalog or storage context. Search/filter state is in the URL, and catalog scroll positions are restored when returning through browser history.

## Fill one box continuously

1. Open Locations, find a box, and open its page.
2. Choose **Fill this box**.
3. Take/select photos and enter the item name.
4. Choose **Save & next**. The destination stays selected; item-specific fields and photos clear.
5. Use **Save & close** to finish with the last item, or **Done** from an empty form.

The progress row separates the number of entries created in the current session from the active entry count in the box. A group containing 20 pieces remains one inventory entry. Retrying a failed photo does not increment the session count again.

Quantity, unit, tags, notes and volume remain optional. Unknown quantity is distinct from zero. In filling mode, you can explicitly repeat tags and the unit for following entries; names, quantities, notes, volumes and photos are not automatically copied.

## Destination selection and creation

Choose **Change** beside the current destination to open the searchable picker. Recent destinations are prioritized. Results distinguish boxes from unboxed locations and show parent paths, so repeated names can be understood.

Create a missing box or location from within the picker. The item draft remains available while the creation form is open. A failed creation keeps the entered name and original item fields. Successful creation selects the new destination and returns to the item editor.

## Locations overview

- **Overview** shows a compact outline with expandable branches.
- **Browse** focuses on top-level folders and individual place pages.
- Search matches place names, box names and their parent paths.
- Pin a location or box for faster access. Pins and view preferences belong to the current browser, so phone and PC can have different shortcuts.
- Location totals include descendants. Counts are calculated by the backend, not from the first page of items.

A location page lists sub-locations, boxes and **Loose items here**. Those loose entries are stored directly in that location. **View all entries inside** includes contents of descendant shelves and boxes.

A box page shows its contents and filling action. Space estimates and capacity are secondary details. Missing volume estimates are stated explicitly, and totals refer to entry volume rather than quantity multiplication.

## Create and edit places

Location creation starts with a name and parent. Contextual creation preselects the parent. **Create & add another** keeps that parent for the next sibling.

For several shelves, select **Add several sibling locations** and enter one name per line. The batch is transaction-safe and repeated requests reuse the same creation IDs. Duplicate names within the batch are rejected. Optional icons and colors are stored in SQLite.

Boxes retain custom labels such as Box 10 or Christmas decorations, with an independent immutable internal number. **Create & start filling** goes directly into the new box's filling workflow. Capacity remains optional.

Edit and delete place actions are in the place options menu. Reparenting excludes the location itself and its descendants. Nonempty boxes and locations must be emptied before deletion; their contents are available on the same page.

## Find and manage items

Use grid view for photos or list view for readable names and addresses. The Filters sheet covers location, box, tag, archive status, out-of-stock entries and sorting. A location filter can include sub-locations or restrict results to that place. Search also matches ancestor location names.

Applied filters appear as removable chips. **Load more** extends the displayed results without selecting unloaded entries or resetting the scroll position.

Choose **Select** to enter selection mode. **Select all shown** covers only currently loaded rows. The bottom selection toolbar offers Move, Delete selected and Cancel. Changing the search/filter selection clears the selected set to avoid acting on hidden results.

Permanent deletion confirms the count and representative names, removes item records and photo metadata atomically, and reports any file-cleanup failure. Stale selections are rejected as a whole. Archive remains separate and can be undone from the confirmation message if the record has not changed elsewhere.

## Photos, drafts and errors

Pending photos show Ready, Uploading or Needs retry individually. Saved photos are shown separately. Use **Retry remaining photos** or an individual Retry button. Successful uploads are retained, and stable request IDs prevent duplication after an uncertain response.

Saved photos can be dragged into order or managed through their options menu, with accessible Move earlier/later, Make cover and Remove actions.

Tap an item image for the full-screen viewer. Swipe between images, pinch or use buttons to zoom, and drag an enlarged image to inspect details. A failed full-size image can be retried.

Draft text can be restored after a page reload. Pending photo File objects are not persisted on the phone: the interface explicitly asks you to reselect unsaved photos after reload. Once saved, inventory and photo files are held on the PC.

An inherited destination is not treated as an unsaved edit. Back protects actual changes. Explicitly discarding a draft also removes its saved draft text. If an item changed on another device, Reload saved item provides a controlled way to discard the stale draft and load the latest version.

Chrome on Android still owns native file-input camera selection. The rear-camera hint is kept, but ordinary LAN HTTP does not guarantee its choice. Gallery selection remains available and this update does not add an HTTPS requirement.

## Verification and remaining device checks

Automated tests cover box filling, per-file retry, session counting, inherited destinations, dirty-form navigation, inline creation failure/recovery, selection/deletion, descendant totals, loose-item filters, ancestor search, batch creation, thumbnail access and restoration of older-schema backups.

Production build, typecheck, lint, frontend/API tests and the local data integrity check were run. Browser UI automation could not complete its viewport review because its URL-confidence policy blocked navigation. Actual Android Chrome keyboard placement, pinch/drag behavior, native capture and 320–430px visual layouts still need a physical-device check.

Use the task checklist in `mobile-ui-improvement-plan.md` for that review. The implementation keeps the existing LAN HTTP hosting and relative `/api` requests.
