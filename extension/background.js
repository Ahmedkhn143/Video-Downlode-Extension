// ─────────────────────────────────────────────
//  PlaylistGet — background.js (Service Worker)
//  Receives download jobs from popup,
//  sends them to the local Node.js backend,
//  and streams progress back to popup.
// ─────────────────────────────────────────────

const BACKEND = 'http://localhost:7474';

// ── Listen for messages from popup ────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startDownload') {
    handleDownload(msg.job);
  }
  return true;
});

// ── Main download handler ─────────────────────
async function handleDownload(job) {
  const { id, url, type, format, quality, embed, playlistItems, downloadPath } = job;

  notifyProgress(id, 'queued', 0);

  try {
    // 1. Tell backend to start downloading
    const endpoint = type === 'playlist' ? '/download-playlist' : '/download';

    const res = await fetch(`${BACKEND}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, url, format, quality, embed, playlistItems, downloadPath }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Download failed');
    }

    // 2. Poll for progress until done
    await pollProgress(id);

  } catch (err) {
    console.error('[PlaylistGet] Download error:', err.message);
    notifyStatus(id, 'error', 0);
  }
}

// ── Poll backend for progress ─────────────────
async function pollProgress(id) {
  const maxAttempts = 3600; // poll for up to 1 hour (1 poll/sec)
  let attempts = 0;

  while (attempts < maxAttempts) {
    await sleep(1000);
    attempts++;

    try {
      const res  = await fetch(`${BACKEND}/progress/${id}`);
      const data = await res.json();

      if (data.status === 'done') {
        notifyProgress(id, 'done', 100, data.downloaded, data.speed, data.total);
        break;
      } else if (data.status === 'error') {
        notifyStatus(id, 'error', data.progress || 0, data.speed, data.total);
        break;
      } else if (data.status === 'canceled') {
        notifyStatus(id, 'canceled', data.progress || 0, data.speed, data.total);
        break;
      } else if (data.status === 'paused') {
        notifyStatus(id, 'paused', data.progress || 0, data.speed, data.total);
        break;
      } else {
        notifyProgress(id, 'downloading', data.progress || 0, data.downloaded, data.speed, data.total);
      }
    } catch {
      // Backend might be busy, retry
    }
  }
}

// ── Send progress to popup ────────────────────
function notifyProgress(id, status, progress, downloaded = 0, speed = null, total = null) {
  chrome.runtime.sendMessage({
    action: 'progress',
    id, status, progress, downloaded, speed, total
  }).catch(() => {}); // popup might be closed
}

function notifyStatus(id, status, progress, speed = null, total = null) {
  notifyProgress(id, status, progress, 0, speed, total);
}

// ── Utility ───────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('[PlaylistGet] Background service worker ready.');
