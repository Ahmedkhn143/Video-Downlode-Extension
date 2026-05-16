// ─────────────────────────────────────────────
//  PlaylistGet — content.js
//  Runs on every page. Detects video/playlist URLs.
// ─────────────────────────────────────────────

let detectedData = null;

// ── Playlist URL patterns ──────────────────────
const PLAYLIST_PATTERNS = [
  /[?&]list=[A-Za-z0-9_-]+/,            // YouTube playlist
  /\/playlist\//i,                        // Generic /playlist/ path
  /\/playlists\//i,
  /\/channel\/.*\/videos/i,              // YouTube channel videos
  /\/sets\//i,                           // SoundCloud sets
  /\/album\//i,                          // Bandcamp / others
  /[?&]collection=/i,
];

// ── Single video patterns ─────────────────────
const VIDEO_PATTERNS = [
  /youtube\.com\/watch\?v=/,
  /youtu\.be\/[A-Za-z0-9_-]+/,
  /vimeo\.com\/\d+/,
  /dailymotion\.com\/video\//,
  /facebook\.com\/.*\/videos\//,
  /twitter\.com\/.*\/status\//,
  /instagram\.com\/p\//,
  /tiktok\.com\/@.*\/video\//,
];

// ── Detect current page ────────────────────────
function detectCurrentPage() {
  const url = window.location.href;

  const isPlaylist = PLAYLIST_PATTERNS.some(p => p.test(url));
  const isVideo    = !isPlaylist && VIDEO_PATTERNS.some(p => p.test(url));

  if (isPlaylist || isVideo) {
    // Try to count videos in playlist (works for YouTube)
    let count = null;
    try {
      const countEl = document.querySelector(
        'yt-formatted-string.byline-item, ' +            // YouTube playlist header
        '[class*="playlistCount"], ' +
        '[aria-label*="videos" i]'
      );
      if (countEl) {
        const match = countEl.textContent.match(/\d+/);
        if (match) count = parseInt(match[0]);
      }
      // Also try ytd-playlist-header-renderer
      const header = document.querySelector('ytd-playlist-header-renderer');
      if (header) {
        const txt = header.innerText;
        const m   = txt.match(/(\d+)\s+videos?/i);
        if (m) count = parseInt(m[1]);
      }
    } catch {}

    detectedData = { url, isPlaylist, isVideo, count };
  }
}

// ── Respond to popup asking for detected data ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getDetected') {
    if (!detectedData) detectCurrentPage();
    sendResponse(detectedData || null);
  }
  return true; // keep channel open for async
});

// ── Auto-run on page load ─────────────────────
detectCurrentPage();

// Also watch for URL changes (YouTube uses SPA routing)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    detectedData = null;
    setTimeout(detectCurrentPage, 800); // wait for DOM to update
  }
});
observer.observe(document.body, { subtree: true, childList: true });
