# LunasStorage mobile interface improvement plan

Prepared 12 October 2026. This is a proposed roadmap based on the current React components, styles and local API. It is a code-based review, not a new physical-phone usability test. App changes have not been implemented as part of this plan.

## 1. Recommended direction

Organize the interface around three everyday jobs:

1. **Find something:** search a photo catalog and see its complete storage address.
2. **Fill a box:** choose a destination once, then add items and photos continuously.
3. **Organize storage:** see the location hierarchy, create places and boxes in context, and understand what is inside each place.

The most valuable change is a real **Fill this box** workflow. A clear location overview is the second priority. Visual polish should support those workflows: fewer competing controls, readable addresses, larger touch areas and visible progress.

Use the existing green palette, photo cards, item pages, free-form locations and custom box labels. The PC remains the authoritative home of inventory and photos. The current LAN HTTP setup is a design constraint; the camera flow must remain usable through native capture and gallery selection.

## 2. What the current implementation suggests improving

| Current behavior | Effect on the phone | Proposed change | Priority |
| --- | --- | --- | --- |
| Primary navigation is hidden in a drawer | Switching between items and locations takes extra interaction | Visible bottom navigation; drawer for secondary tools | High |
| Fill this box opens the general item dialog | Continuous entry has no dedicated context or progress | A box-filling screen with Save & next as the primary action | High |
| Destination selection is one large select with location groups | Finding a box gets harder as storage grows | Searchable destination picker with full paths, recent boxes and contextual creation | High |
| Storage browsing starts at the root when the component remounts | Returning from box contents loses the place being explored | Route-based location and box pages; restore browsing position | High |
| Location rows count only directly attached boxes | A room can appear to have zero boxes even when shelves contain several | Clearly labeled totals including descendants | High |
| Storage browsing shows child locations and boxes, but no direct items | Items stored without boxes are hard to discover there | A Loose items section on location pages | High |
| Filters, archive toggle and bulk controls consume space above cards | Less room for the catalog itself | Search plus a Filters button; show selection actions only in selection mode | Medium |
| Small selection and photo-remove controls | Higher risk of missed taps | Larger hit areas and less frequent destructive controls | High |
| Form actions are at the end of scrollable dialogs | Saving competes with scrolling and the keyboard | Fixed form shell with a reachable action footer | High |
| Discard logic checks whether fields have values | A remembered destination can count as an unsaved change; location inputs use a different state model | Compare each form with its initial state | High |
| Photos have previews, but mostly one shared save status | Partial success requires reading messages carefully | Status on each photo and a clear saved-item status | Medium |
| Archive is an icon on every item card | Accidental taps can change the inventory | Move archive into item actions; provide a safe archive undo | Medium |

## 3. Navigation designed for one-handed use

### Mobile

Use a bottom navigation bar with three destinations: **Items**, **Locations**, **More**. More contains settings, backup/export, account and help. Keep the existing drawer available for those secondary actions.

Place a separate, labeled creation button above the bar. Its action follows the current screen:

- Items: **+ Add item**.
- All locations: **+ Location**.
- Inside a location: **+ Add here**, opening choices for an item, box or sub-location.
- Inside a box: **+ Add item**, with the box already selected; prominently offer **Fill this box** for continuous entry.

Add is an action, rather than a navigation tab. This follows the distinction between destinations and actions in the Material navigation guidance.

```text
┌──────────────────────────────┐
│ Inventory                    │
│ [ Search your inventory... ] │
│ [Filters · 2]    [Grid/List]  │
│  [Box 10 ×] [Hardware ×]      │
│                              │
│ ┌───────────┐ ┌───────────┐   │
│ │   Photo   │ │   Photo   │   │
│ │ Brackets  │ │ Screws    │   │
│ │ Box 10    │ │ Box 10    │   │
│ └───────────┘ └───────────┘   │
│                  [+ Add item]│
├──────────────────────────────┤
│   Items    Locations    More │
└──────────────────────────────┘
```

Honor Android Back and browser Back: close a picker first, then return to the previous location or item list, restoring its scroll position. Avoid binding the entire left edge to a gesture that competes with Android Back or horizontal photo swipes. Every gesture must also have a visible button.

### Desktop

Use the same destinations in a side navigation panel. The location tree can sit beside the selected location's contents. Shared workflows should behave the same across phone and PC even when their layouts differ.

## 4. Make adding items into a box a continuous task

### A dedicated filling screen

Enter this mode from a box page. Keep the box identity and full location path visible throughout the task. Treat the destination as a compact context row with a **Change** action, rather than a large select that must be revisited.

```text
┌──────────────────────────────┐
│ ← Fill Box 10         Done   │
│ Basement / Shelf / Middle    │
│ Adding to Box 10    [Change] │
│ 5 added this session         │
├──────────────────────────────┤
│ [Take photo] [Choose photos] │
│ [preview] [preview] [+]      │
│                              │
│ Item name                    │
│ [Shelf brackets            ] │
│                              │
│ [Quantity] [Tags] [Notes]    │
│ More details                 │
├──────────────────────────────┤
│ [Save & next]   [Save & close]│
└──────────────────────────────┘
```

The main loop is **photo → name → Save & next**. Photos remain optional: name and destination are still the only required fields. Avoid forcing a wizard with separate steps for every item.

After a successful save:

- Clear the name, item-specific details and photos.
- Keep the selected destination.
- Show a short confirmation naming the saved item and box.
- Increment the session count exactly once, including when photos needed retries.
- Keep the form ready for another item.

Show **Added this session** separately from **Total entries in this box**. A quantity of 20 screws is one inventory entry, not 20 newly added entries.

### General item entry

Use a full-height editor on mobile, with a stable header and action footer. Start with the photo controls, name and destination context. Put quantity, tags, notes and volume behind clear optional controls.

Do not immediately open the keyboard when entering a photo-first flow. When the user taps Name, move the footer above the keyboard and keep the input visible. For a text-first shortcut, focus Name intentionally.

Use **Save item** as the primary action outside filling mode, with **Save & next** available as a secondary action. Inside filling mode, reverse that emphasis.

### Helpful defaults without accidental copying

Keep remembering the destination. Optionally let the user opt into repeating selected tags or a quantity unit for the current filling session. Never silently carry over a previous item's name, notes, photos or quantity. Unknown quantity remains distinct from zero.

If a photo fails, keep the saved item and only the failed photos pending. Make **Retry remaining photos** explicit. Moving to the next item while abandoning failed photos should require a clear choice; it must not happen silently.

## 5. Replace long destination dropdowns with a picker

The picker should contain:

- A search field that matches box labels and location names.
- Recent destinations at the top.
- A clear distinction between a box and an unboxed location.
- Full ancestor paths below results, so two shelves with the same name can be distinguished.
- A browse option for the location hierarchy.
- **Create a box here** and **Create a location** when the destination does not exist yet.

Example result:

```text
Box 10
Basement › Storage shelf › Middle shelf
```

Creating a destination from an item editor should push a short creation screen, then return to the preserved item draft with the new destination selected. Avoid stacking multiple scrollable dialogs over each other. A failed destination creation must preserve both forms' input.

Validate remembered destinations when opening a draft. If a location or box was deleted elsewhere, explain that it is unavailable and ask for a replacement instead of saving to a stale ID.

## 6. Give locations both an overview and a focused browsing view

### Overview: understand the whole structure

Add a compact **Overview / Browse** switch within Locations. Overview shows an outline tree, with small, consistent rows. Start with top-level places and a shallow preview; allow expansion of individual branches and an optional Expand all action.

```text
┌──────────────────────────────┐
│ Locations                    │
│ [Find a location or box...]  │
│ [Overview] [Browse]          │
│ 8 locations · 12 boxes       │
├──────────────────────────────┤
│ ▾ Basement                   │
│   6 boxes · 74 entries inside│
│   ▾ Storage shelf            │
│     ▸ Upper shelf            │
│     ▾ Middle shelf           │
│       □ Box 10 · 18 entries  │
│       □ Seasonal · 9 entries │
│ ▸ Office                     │
│   3 boxes · 26 entries inside│
│ ▸ Garage                     │
│   3 boxes · 31 entries inside│
│                 [+ Location]│
├──────────────────────────────┤
│   Items    Locations    More │
└──────────────────────────────┘
```

Use the chevron to expand a branch and the row's name to open its page. Show management actions in an overflow menu rather than repeating Edit, Delete and Add beside every row. Indentation should stay narrow; deeply nested paths must not leave too little width for names.

Location search returns results with full paths. Choosing a match reveals its ancestors and opens the selected location or box. A later convenience feature can pin frequently used places; favorites should not be required to make the overview usable.

### Browse: work in one place

Keep the current folder approach for focused browsing, but give each location and box its own route so Back, refresh and return-from-item behavior preserve context.

A location page should show:

1. Name, parent path and a compact summary.
2. Sub-locations.
3. Boxes, each with an entry count and at most a small contents preview.
4. **Loose items stored directly here**.
5. Contextual creation and an overflow menu for management.

Loose items are important: a location with no boxes may still contain inventory. Its empty state must never claim the place is empty when direct items exist.

A box should open a real box page, not only expand a control panel in a row. Show its name, full path, contents and filling action together. Put capacity and volume estimates in a secondary Details section, with the missing-estimate count stated explicitly.

### Counts must be trustworthy

Define counts consistently:

- Location overview totals include all descendant locations, their boxes and their items.
- The location page distinguishes direct contents from everything inside its descendants.
- Entry totals count item records, not the sum of quantity values.
- Active totals exclude archived entries by default; archive counts have separate labels.
- Empty boxes have zero entries; boxes with only archived items are labeled appropriately.
- A box move updates ancestor totals and displayed addresses.

Fetch these totals from the backend. Do not derive inventory totals from the currently loaded 30-item page. The same definitions should drive overview rows, box pages and filtering.

## 7. Create locations and boxes in context

### Locations

The basic creation form should have just **Name** and **Inside**. Inside is already selected when adding from a location page. On the root overview it defaults to Top level. Display the parent path so it is obvious where the new place will appear.

Examples such as Room, Cupboard, Shelf and Drawer can suggest names, but locations remain free-form. Do not require a fixed room/shelf/position structure.

After saving, offer clear next actions: **Open location**, **Add box**, or **Add another location in this parent**. Keep the chosen parent when adding several sibling shelves. Icons or subtle colors can be an optional later enhancement.

For initial organization, a later **Add several locations** screen could accept one name per line under the same parent. It needs explicit results and safe retries; it should follow the simpler creation improvements.

### Boxes

The first screen should require only the destination location and box label. Keep capacity optional. Support familiar labels such as Box 10 or Christmas decorations, preserving the current distinction between label and immutable internal number.

After creating a box, offer **Start filling this box** immediately. Avoid making the user find the newly created box again.

Warn about an existing identical name within the same parent, but allow an explicit choice to proceed. The same shelf or box name in different locations is valid; path context handles that ambiguity.

### Moving places

Use the same destination picker for box relocation and location reparenting. Show the current and proposed parent before saving. Preserve cycle prevention and stale-edit checks. If deletion is blocked by contents, link directly to those contents rather than only displaying a generic error.

## 8. Improve finding and browsing items

Keep the store-like photo grid and dedicated item pages. Refine their density:

- Show the photo, up to two readable title lines and a concise box/location label.
- Put the full address on the item page or an accessible expanded view.
- Show only the most useful quantity/status and tags on the card.
- Offer a List view for scanning long names and addresses.
- Preserve grid/list preference, filters, query and scroll position when returning from an item.

Keep search prominently visible. Put the detailed filters in a bottom sheet with **Apply**, **Clear** and an active-filter count. Applied filters appear as removable chips above results. Move Archived into that sheet or a clear collection switch, so its current state cannot be mistaken for an action on one item.

Location filters should distinguish **This location only** from **Including sub-locations**. Searching for a room name should also find items in its shelves: the backend needs to search ancestor paths, not only the immediate location name.

Show a useful empty-results state: “No matches with these filters” with a clear reset action. Keep it distinct from a genuinely empty inventory. Start with explicit Load more pagination while preserving scroll, rather than an endless list that is difficult to navigate back through.

## 9. Make photos and item pages easier to use

Keep separate Take photo and Choose photos controls. Make their touch areas large, and bring photos above optional item details during creation. Display pending images as a horizontal strip or compact grid with a clear Add another photo action.

Each photo should show its own state: Ready, Uploading, Saved, or Retry. Mark the cover image. Reordering should have both drag support and accessible alternatives. Remove controls need a large hit area even if their icon stays small.

On the item page, provide a full-screen photo viewer with swipe, zoom and a visible Close button. Return to the same active image on closing it. Avoid fetching the same full image separately for every thumbnail when a reusable local cache or thumbnail response can serve it efficiently.

The Android Chrome native camera may still choose the selfie camera despite the rear-camera hint. A UI redesign must not promise to control that on ordinary LAN HTTP. The accepted current setup keeps native capture and gallery available; local HTTPS is a separate future decision.

## 10. Mobile interaction, feedback and safety

### Forms and keyboard

- Use a full-height item editor and short sheets for small choices or simple creation forms.
- Keep the active field visible and the save action reachable with the keyboard open.
- Hide the primary navigation while a form is active, so it cannot be mistaken for form navigation.
- Support Android Back, Escape on desktop, focus management and clear screen-reader labels.
- Track actual changes against the form's starting values. Inherited destination context is not an unsaved edit.
- Preserve drafts during navigation inside the app. Later, restore text drafts after reload with a clear explanation that pending File objects may need to be selected again. Persistent photo drafts require a separate storage decision.

### Reach and readability

Aim for 48 CSS pixel primary touch areas, with at least 44 CSS pixels for secondary icon buttons where practical. This is a usability target above WCAG's minimum requirements, not a claim that 48 pixels is the WCAG AA minimum. Keep important input text around 16px, readable contrast, visible focus and support for enlarged text.

Use safe-area spacing and one shared overlay/footer system. The bottom navigation, selection toolbar, form footer and keyboard must not cover each other. Support reduced motion; animations should clarify transitions rather than delay entry.

### Bulk selection and destructive actions

Use a visible Select action to enter selection mode. Optional long-press can be a shortcut. While selected, show a compact bottom toolbar with the count, Move, Delete and Cancel. Provide Select all shown, explicitly stating that it covers visible results only.

Keep the current permanent-delete confirmation and stale-version protection. Show the count and representative item names before removal. Never label permanent deletion as undoable unless a real trash/restore feature is built with retained photos. Archive can offer Undo once its version checks make that rollback safe.

### Errors and connection state

Put field errors next to their inputs, upload failures next to the affected photos, and task errors inside the active screen. Avoid showing the same error behind a dialog and inside it. Use readable messages rather than raw validation JSON.

When the PC is unreachable, retain the form and distinguish the connection failure from incorrect login details. Clearly state which items and photos have already been saved. This plan does not require phone-side offline synchronization.

## 11. Implementation approach

Most initial improvements are UI and navigation work. The location overview and richer contents need additional typed backend responses.

1. Extract the existing large App component into focused navigation, editor, destination-picker and feedback components.
2. Introduce route state for location, box, item and filling screens. Preserve hash routing for the existing local server setup.
3. Add a shared form shell, dirty-state handling, selection toolbar and message system.
4. Add storage summary queries with descendant counts and explicit direct/subtree filtering. Reuse these definitions everywhere.
5. Add server-side ancestor-path search and small photo thumbnail responses if performance testing shows they are needed.
6. Persist simple view preferences separately from authoritative inventory records. Add versioned migrations only for genuine new metadata, such as optional location appearance or shared favorites.

Keep stable IDs, version checks, custom box labels, multiple-photo retry IDs, authenticated local API access and the project data directory throughout the changes. Visual empty states and badges must use real saved data.

## 12. Phased delivery

| Phase | Deliverables | Relative effort | Completion criteria |
| --- | --- | --- | --- |
| 1: Faster phone entry | Shared mobile form shell, dirty-state fixes, contextual destination row, true Fill this box mode, reachable save actions | Medium | Add ten items to one box without reopening a destination selector or losing a failed upload |
| 2: Clear storage overview | Compact outline, route-based browsing, searchable destination picker, box pages, loose items, accurate descendant totals | Large | Every stored item is discoverable through its actual location; Back and refresh preserve context |
| 3: Better catalog navigation | Bottom navigation, contextual creation, filter sheet/chips, list view, preserved item-list position, selection toolbar | Medium | Find an item, inspect it, move it and return to the same results using one hand |
| 4: Photo and setup polish | Per-photo progress, gallery zoom/swipe, sibling creation, optional appearance/pins, thumbnail optimization if needed | Medium | Multi-photo entry is clear through success, partial failure, cancellation and retry |

Make phases 1 and 2 the first implementation milestone. Bottom navigation can begin alongside phase 1 if it simplifies the shared form layout. Test a small coherent vertical workflow before widening the redesign to all screens.

## 13. How to validate the redesign

Use representative widths of 320, 360, 390, 412 and 430 CSS pixels, portrait and landscape, keyboard open, and enlarged text. Desktop remains useful for bulk organization and backup tasks.

Test on the actual Android Chrome phone as well as automated component/API tests:

1. Create Basement, a shelf inside it, and Box 10; start filling immediately.
2. Add ten items, including one without photos and one grouped quantity; keep the destination throughout.
3. Add three photos to an item, fail one upload deliberately in a test environment, and retry without duplicating the item or completed photos.
4. Cancel an untouched form with a remembered destination; leave a genuinely edited form and verify the discard protection.
5. Store an item directly in a location and find it through Locations.
6. Search for a box and an ancestor room; verify results beyond the first page and disambiguate identical names in different parents.
7. Open an item from midway down a filtered list, use Back, and recover the same query, filters and scroll position.
8. Move a box, inspect updated paths/counts, and confirm a stale edit from the other device is rejected.
9. Select and delete a batch in a disposable test inventory; verify the exact confirmation and photo cleanup behavior.
10. Interrupt the LAN connection during entry and verify that the interface preserves input and reports saved versus unsaved parts accurately.

Useful acceptance targets:

- No repeated destination selection while filling a box.
- No horizontal page scrolling at 320px.
- Main actions remain reachable with the keyboard open.
- All location and box rows show clear hierarchy and trustworthy counts.
- Loose items never disappear from the storage overview.
- Returning from an item does not restart browsing at the root or top of the list.
- Photo retries never create duplicate records or duplicate completed uploads.
- Destructive actions require an explicit, clearly named confirmation.

## Reference guidance

- [Material navigation guidance](https://m2.material.io/design/navigation/): primary navigation and the distinction between navigation patterns.
- [Material bottom navigation](https://m1.material.io/components/bottom-navigation.html): destinations in the navigation bar, with actions handled separately.
- [WCAG 2.2 target-size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): minimum target sizing and spacing exceptions.
- [WCAG enhanced target size](https://www.w3.org/WAI/WCAG21/Understanding/target-size): larger targets as additional accessibility guidance.

The screen arrangements, priorities, wireframes and acceptance targets above are proposals for this app, rather than externally measured usability results.
