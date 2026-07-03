# Obsidian-Style Bookmark Graph — Design

## Problem

The bookmark graph (`BookmarkSphere.tsx`) is already a Canvas d3 force-graph with colored nodes, search, drag, and zoom, but its link-building makes a dense "hairball" unlike Obsidian's clean graph: `buildGraphData` links **every** same-category pair (a full clique per category, O(n²)) **plus** a ring through all bookmarks. With more than a few bookmarks per category this produces a tangled mass. The user wants it to look and behave like Obsidian's graph view, with colorful nodes.

## Goals

- Sparse, readable structure like Obsidian: clusters that are visibly grouped by category but not densely inter-linked.
- One connected graph (no floating orphans) — matches the app's existing "everything is connected" intent.
- Vivid, distinct per-category node colors.
- Keep all existing behaviors: hover highlight, labels-on-zoom, drag, pan/zoom, search, context menu, add/remove.

## Non-goals

- No 3D. Obsidian's graph is 2D; the current 2D canvas stays.
- No change to search, context menu, or the add/remove bookmark flow.
- No new dependencies.
- Not touching the force-simulation tuning beyond what the new link set naturally changes.

## Design

### 1. Link-building rewrite (`buildGraphData`)

Replace the clique + ring with an Obsidian-like **star-cluster** topology:

- Group bookmarks by category.
- Within each category, pick the first bookmark as the cluster **anchor**; link every other same-category bookmark to that anchor only (a star, ~`n-1` links per cluster instead of `n(n-1)/2`).
- Link the anchors of each category together in a ring (loose center), so all clusters form one connected graph.
- Single-bookmark categories: their lone node is an anchor and joins the anchor ring, so nothing floats alone.
- Edge case — only one bookmark total: no links (single node), no crash.
- `connections` count per node is still derived from the resulting links, so node size (`18 + (conn/maxConn)*34`) and hub detection (`connections >= HUB_THRESHOLD`) continue to work; anchors naturally become the larger hubs, exactly like Obsidian's well-linked notes.

Link strengths: anchor↔member `0.55` (tight cluster), anchor↔anchor ring `0.18` (loose). These feed the existing force sim's link strength.

### 2. Node color vividness

- Keep the existing `CATEGORY_COLORS` palette and `resolveColor`. Raise the resting core fill alpha for connected/matched nodes from `0.88` to `1.0` and the ring stroke from `0.65` to `0.85`, so colors read fully saturated (Obsidian's nodes are solid-colored). Dimmed (non-connected/non-match) alphas are unchanged.
- No structural change to the aura/glow code — it already tints per node color.

### 3. Behaviors

Unchanged — hover highlight, labels-on-zoom, drag, pan/zoom, search dimming, selection all keep working because they operate on nodes/links generically. The only input that changed is the link set, which those systems already consume.

## Error handling

- Empty bookmark list → no nodes, no links (existing guard renders empty canvas).
- One bookmark → one node, zero links.
- Categories with missing/empty category string → treated as their own group keyed by `''` (grouped together), consistent with `resolveColor`'s default handling.

## Testing

No automated suite. Manual, in the running dev app:

1. Open the Bookmark Sphere with the default bookmarks → nodes are vivid, grouped in visible clusters, links are sparse (star per category + thin ring between clusters), not a hairball.
2. Hover a node → it and its neighbors stay bright, rest fades.
3. Zoom in → labels fade in; drag a node → it moves and the sim settles; pan/zoom smooth.
4. Search → matching nodes highlight, others dim.
5. Add a bookmark in a new category → a new cluster anchor appears and joins the ring; remove one → graph re-links without orphans or crash.
