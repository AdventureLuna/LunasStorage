# Local deployment checks

Automated checks: build frontend, run Vitest, run `python -m pytest backend/tests -q`, inspect the build for cloud endpoints, and run the local HTTP smoke check against FastAPI serving `dist` and `/api` together.

Physical phone checklist (not equivalent to a local automated test):

1. Start the PC server and create the single account through localhost.
2. Connect phone to the same private Wi-Fi, allow the configured TCP port on Windows Firewall for Private/Local subnet, and open the PC's LAN candidate URL.
3. Sign in; verify 320–430px layout, sidebar swipe, folder navigation and item pages.
4. Create a location and custom-named box, add two photos using native camera/gallery file inputs, then Save & add another and confirm the destination stays selected.
5. Edit on PC and phone; check stale saves are rejected. Search by name, tag, box and location, move and archive/restore items.
6. Download the full local ZIP, restore it into a new directory with the server stopped, and verify records/photos after login.
7. Disconnect internet while keeping home LAN connected and repeat search, photo viewing and editing. No cloud endpoints/assets are needed.

Do not add router port forwarding. Keep the PC awake. Distinguish checks against the local machine's LAN address from a request made by the actual phone.
