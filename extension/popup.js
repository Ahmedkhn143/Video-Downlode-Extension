// ─────────────────────────────────────────────
//  PlaylistGet — popup.js
//  Handles all popup UI interactions
// ─────────────────────────────────────────────

const BACKEND = 'http://localhost:7474';

// DOM refs
const statusDot      = document.getElementById('status-dot');
const urlInput       = document.getElementById('url-input');
const selFormat      = document.getElementById('sel-format');
const selQuality     = document.getElementById('sel-quality');
const btnDownload    = document.getElementById('btn-download');
const btnPlaylist    = document.getElementById('btn-playlist');
const btnGrab        = document.getElementById('btn-grab');
const btnClear       = document.getElementById('btn-clear');
const msgBox         = document.getElementById('msg-box');
const queueList      = document.getElementById('queue-list');
const queueCount     = document.getElementById('queue-count');
const detectedBanner = document.getElementById('detected-banner');
const detectedUrl    = document.getElementById('detected-url');
const detectedType   = document.getElementById('detected-type');
const detectedCount  = document.getElementById('detected-count');

// Local queue (stored in chrome.storage.local)
let queue = [];

// ── Init ──────────────────────────────────────
async function init() {
  await checkBackend();
  await loadQueue();
  await getDetectedUrl();
}

// ── Backend health check ──────────────────────
async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND}/ping`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      statusDot.classList.add('online');
      statusDot.title = 'Backend running ✓';
    } else throw new Error();
  } catch {
    statusDot.classList.add('offline');
    statusDot.title = 'Backend offline — start server.js first';
    showMsg('Backend offline. Run: node server.js in your backend folder.', 'error');
  }
}

// ── Get URL detected by content script ────────
async function getDetectedUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'getDetected' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.url) {
        detectedUrl.textContent   = response.url;
        detectedType.textContent  = response.isPlaylist ? '🎵 Playlist detected' : '🎬 Video detected';
        detectedCount.textContent = response.count ? `${response.count} videos` : '';
        detectedBanner.classList.add('show');
        urlInput.value = response.url;
      }
    });
  } catch (e) {
    // Tab might not support content scripts (chrome:// pages etc.)
  }
}

// ── Download single video ─────────────────────
btnDownload.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) { showMsg('Please enter a URL first.', 'error'); return; }

  await startDownload({
    url,
    type:    'video',
    format:  selFormat.value,
    quality: selQuality.value,
  });
});

// ── Download full playlist ────────────────────
btnPlaylist.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) { showMsg('Please enter a playlist URL.', 'error'); return; }

  showMsg('Fetching playlist info...', 'info');
  btnPlaylist.disabled = true;
  btnPlaylist.textContent = 'Fetching...';

  try {
    const res  = await fetch(`${BACKEND}/playlist-info`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to fetch playlist');

    showMsg(`Found ${data.count} videos in "${data.title}". Starting download...`, 'success');
    await startDownload({
      url,
      type:    'playlist',
      format:  selFormat.value,
      quality: selQuality.value,
      title:   data.title,
      count:   data.count,
    });
  } catch (err) {
    showMsg(err.message, 'error');
  } finally {
    btnPlaylist.disabled = false;
    btnPlaylist.textContent = '▶▶ Full Playlist';
  }
});

// ── Grab detected URL ─────────────────────────
btnGrab.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) return;
  // Treat as playlist download
  btnPlaylist.click();
});

// ── Core: start download via background ───────
async function startDownload(job) {
  const id = Date.now().toString();
  const item = { id, ...job, status: 'queued', progress: 0 };

  queue.push(item);
  await saveQueue();
  renderQueue();
  showMsg(`Added to queue: ${job.type === 'playlist' ? job.title || 'Playlist' : 'Video'}`, 'success');

  // Tell background service worker to handle it
  chrome.runtime.sendMessage({ action: 'startDownload', job: { id, ...job } });
}

// ── Queue persistence ─────────────────────────
async function loadQueue() {
  const data = await chrome.storage.local.get('queue');
  queue = data.queue || [];
  renderQueue();
}

async function saveQueue() {
  await chrome.storage.local.set({ queue });
}

// ── Render queue ──────────────────────────────
function renderQueue() {
  queueCount.textContent = `${queue.length} item${queue.length !== 1 ? 's' : ''}`;

  if (queue.length === 0) {
    queueList.innerHTML = `
      <div class="queue-empty">
        <span class="queue-empty-icon">📂</span>
        No downloads yet
      </div>`;
    return;
  }

  queueList.innerHTML = queue.map(item => `
    <div class="q-item" id="qi-${item.id}">
      <div class="q-top">
        <span class="q-icon">${item.type === 'playlist' ? '🎵' : '🎬'}</span>
        <span class="q-name">${item.title || item.url}</span>
        <span class="q-badge ${item.status}">${badgeText(item)}</span>
        <button class="q-remove" onclick="removeItem('${item.id}')">✕</button>
      </div>
      ${item.status === 'downloading' || item.status === 'done' ? `
        <div class="q-progress-wrap">
          <div class="q-progress-bar" style="width:${item.progress}%"></div>
        </div>
        <div class="q-sub">
          <span>${item.type === 'playlist' ? `${item.downloaded || 0}/${item.count || '?'} videos` : ''}</span>
          <span>${item.progress}%</span>
        </div>` : ''}
    </div>
  `).join('');
}

function badgeText(item) {
  if (item.status === 'downloading') return 'Downloading';
  if (item.status === 'done')        return '✓ Done';
  if (item.status === 'error')       return '✗ Error';
  if (item.type   === 'playlist')    return 'Playlist';
  return 'Queued';
}

// ── Remove item ───────────────────────────────
window.removeItem = async (id) => {
  queue = queue.filter(i => i.id !== id);
  await saveQueue();
  renderQueue();
};

// ── Clear all ─────────────────────────────────
btnClear.addEventListener('click', async () => {
  queue = [];
  await saveQueue();
  renderQueue();
});

// ── Listen for progress updates from background
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === 'progress') {
    const item = queue.find(i => i.id === msg.id);
    if (!item) return;
    item.status     = msg.status;
    item.progress   = msg.progress;
    item.downloaded = msg.downloaded;
    await saveQueue();
    renderQueue();
  }
});

// ── Show message ──────────────────────────────
function showMsg(text, type = 'info') {
  msgBox.textContent  = text;
  msgBox.className    = type;
  clearTimeout(msgBox._t);
  if (type !== 'error') {
    msgBox._t = setTimeout(() => { msgBox.className = ''; }, 4000);
  }
}

// ── Start ─────────────────────────────────────
init();
