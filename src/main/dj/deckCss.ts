// What the hidden YouTube deck window shows: the picture goes to the DJ's
// video monitor, so YouTube's own overlays (title bar, pause screen, "more
// videos", end cards) are kept out of it.
export const DECK_CLEAN_CSS =
  '.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,' +
  '.ytp-large-play-button,.ytp-bezel,.ytp-bezel-text-wrapper,.ytp-watermark,.ytp-ce-element,.html5-endscreen,' +
  '.ytp-cards-teaser,.ytp-paid-content-overlay,.ytp-impression-link,.iv-branding,.annotation{display:none!important}' +
  // YouTube renames its overlay layers (2026: ytp-timely-actions-content, captions):
  // hide every player layer except the video itself, and make it cover the window.
  // The error panel stays laid out (only made invisible below): the state probe
  // detects "video unavailable" through its offsetParent.
  '#movie_player>:not(.html5-video-container):not(.ytp-error){display:none!important}' +
  // …and the 2026 embed draws its bezel, share and logo OUTSIDE #movie_player:
  // anything that is not the video and does not contain it is hidden.
  'body *:not(video):not(:has(video)){visibility:hidden!important}' +
  '.html5-video-container,video{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;object-fit:cover!important}'
