# One-Click Add Current Page to Sphere — Design

## Problem

The nav-bar bookmark button opens the Add Bookmark modal with an empty URL field, so adding the page you're on means retyping its address. The user wants a single button press to drop the current site into the bookmark sphere.

## Goals

- One click on the nav-bar bookmark button adds the current tab (URL + title) to the sphere via the existing AI pipeline (auto-category + duplicate check).
- If the current page is already in the sphere, the same button removes it (toggle), matching the filled/hollow icon it already shows.
- Brief, non-blocking feedback (toast) since there is no modal.
- Disabled on home/special pages (nothing to add).
- Manual "type any URL" add stays available from the Sidebar and the homepage "+", unchanged.

## Non-goals

- No change to `AddBookmarkModal`, the sphere renderer, or the store's bookmark shape.
- No new store state beyond a local transient toast in `NavigationBar`.

## Design

All changes are in `src/renderer/src/components/browser/NavigationBar.tsx`.

- Add imports: `addBookmarkWithAI` from `../../services/bookmarkService`; pull `addBookmark`, `removeBookmark` from the store (already exposed).
- Local state: `toast: string` + a `busy: boolean` to prevent double-submits, and a `setTimeout` to auto-clear the toast (~2s).
- Replace the bookmark button's `onClick` (currently `setAddBookmarkOpen(true)`) with `handleToggleBookmark`:
  - Guard: if `isSpecialPage` or no real URL → ignore (button also rendered `disabled`/dimmed).
  - If `busy` → ignore.
  - If `isBookmarked`: find `bookmarks.find(b => b.url === activeTab.url)`, `removeBookmark(id)`, toast "Removed from sphere".
  - Else: set `busy`, toast "Adding to sphere…", `await addBookmarkWithAI(activeTab.url, activeTab.title || '', bookmarks)`. On `success` → `addBookmark(result.bookmark)`, toast `result.warning ? "Already in sphere — updated" : "Added to sphere"`. On failure → toast `result.error || "Couldn't add"`. Clear `busy` in `finally`.
- Keep the icon's existing hollow/filled binding to `isBookmarked` (updates automatically from the store).
- Toast render: a small fixed-position pill near the top-center/under the nav bar, `pointer-events:none`, fades via opacity, auto-dismiss. Rendered inside NavigationBar's root.

## Error handling

- `addBookmarkWithAI` already normalizes the URL and returns `{success,error,warning}`; the handler surfaces those via toast and never throws to the UI.
- Rapid double-clicks guarded by `busy`.
- Special/home pages: handler no-ops and the button is visually disabled.

## Testing

Manual, in the running dev app:

1. Visit a normal site → click the bookmark button → toast "Added to sphere", icon fills; open the sphere → the site is a node.
2. Click again on the same site → toast "Removed from sphere", icon hollows; sphere no longer shows it.
3. On the home/new-tab page → button is disabled, clicking does nothing.
4. Add a site whose domain already exists → toast reflects the duplicate warning, no crash.
5. Sidebar "+" and homepage "+" still open the manual modal.
