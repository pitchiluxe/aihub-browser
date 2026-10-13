// What the hidden YouTube deck window shows: the picture goes to the DJ's
// video monitor, so YouTube's own overlays (title bar, pause screen, "more
// videos", end cards) are kept out of it.
export const DECK_CLEAN_CSS =
  '.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,' +
  '.ytp-large-play-button,.ytp-bezel,.ytp-bezel-text-wrapper,.ytp-watermark,.ytp-ce-element,.html5-endscreen,' +
  '.ytp-cards-teaser,.ytp-paid-content-overlay,.ytp-impression-link,.iv-branding,.annotation,.ytp-spinner{display:none!important}' +
  // The 2026 embed's own control layer, OUTSIDE #movie_player: title, share,
  // "More videos" and the YouTube logo (found by listing what was left visible).
  // Shrunk to a speck in a corner rather than hidden: YouTube's player slows its
  // video when that layer is not rendered — display:none / opacity:0 /
  // visibility:hidden / :has() all held the deck video to 4–8 fps; shrunk, it
  // is a steady ~13.5 fps (measured 2026-10-12, 3 runs).
  '#player-controls,.ytPlayerControlsContainerHost{transform:scale(.004)!important;transform-origin:100% 100%!important;pointer-events:none!important}' +
  // YouTube renames its overlay layers (2026: ytp-timely-actions-content, captions):
  // hide every player layer except the video itself, and make it cover the window.
  // The error panel stays laid out (only made invisible below): the state probe
  // detects "video unavailable" through its offsetParent.
  '#movie_player>:not(.html5-video-container):not(.ytp-error){display:none!important}' +
  // Never hide the video's surroundings wholesale (`visibility:hidden` on its
  // ancestors, or `:has()` over the whole page): Chromium then treats it as an
  // invisible video and throttles it — the deck video fell to ~4 fps; without
  // that it plays at 17–20 fps (measured 2026-10-12). The full-window video
  // below covers what is left.
  '.html5-video-container,video{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;object-fit:cover!important;z-index:2147483647!important}'
