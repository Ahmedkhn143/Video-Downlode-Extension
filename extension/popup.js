// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  NexDown â€” popup.js
//  Handles all popup UI interactions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

const btnOpenFolder  = document.getElementById('btn-open-folder');
const playlistRangeRow = document.getElementById('playlist-range-row');
const playlistRangeInput = document.getElementById('playlist-range-input');
const chkEmbed       = document.getElementById('chk-embed');
const pathInput      = document.getElementById('path-input');

// Playlist patterns to toggle range selection field
const PLAYLIST_PATTERNS = [
  /[?&]list=[A-Za-z0-9_-]+/,
  /\/playlist\//i,
  /\/playlists\//i,
  /\/channel\/.*\/videos/i,
  /\/sets\//i,
  /\/album\//i,
  /[?&]collection=/i,
];

function isPlaylistUrl(url) {
  return PLAYLIST_PATTERNS.some(p => p.test(url));
}

function updateRangeInputVisibility() {
  const url = urlInput.value.trim();
  if (isPlaylistUrl(url)) {
    playlistRangeRow.classList.add('show');
  } else {
    playlistRangeRow.classList.remove('show');
  }
}

// Local queue (stored in chrome.storage.local)
let queue = [];
let lastVideoQuality = selQuality.value;
let backendOnline = false;
let syncTimer = null;

function updateQualityForFormat() {
  if (selFormat.value === 'mp3') {
    if (selQuality.value !== 'best') lastVideoQuality = selQuality.value;
    selQuality.value = 'best';
    selQuality.disabled = true;
  } else {
    selQuality.disabled = false;
    if (lastVideoQuality) selQuality.value = lastVideoQuality;
  }
}

// â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function init() {
  updateQualityForFormat();
  await checkBackend();
  await loadQueue();
  if (backendOnline) {
    await syncQueueWithBackend();
    startQueueSync();
  }
  await getDetectedUrl();
  updateRangeInputVisibility();
}

// â”€â”€ Backend health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND}/ping`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      backendOnline = true;
      statusDot.classList.add('online');
      statusDot.title = 'Backend running âœ“';
    } else throw new Error();
  } catch {
    backendOnline = false;
    statusDot.classList.add('offline');
    statusDot.title = 'Backend offline â€” start server.js first';
    showMsg('Backend offline. Run: node server.js in your backend folder.', 'error');
  }
}

// â”€â”€ Get URL detected by content script â”€â”€â”€â”€â”€â”€â”€â”€
async function getDetectedUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'getDetected' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.url) {
        detectedUrl.textContent   = response.url;
        detectedType.textContent  = response.isPlaylist ? 'ðŸŽµ Playlist detected' : 'ðŸŽ¬ Video detected';
        detectedCount.textContent = response.count ? `${response.count} videos` : '';
        detectedBanner.classList.add('show');
        urlInput.value = response.url;
        updateRangeInputVisibility();
      }
    });
  } catch (e) {
    // Tab might not support content scripts (chrome:// pages etc.)
  }
}

// â”€â”€ Download single video â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
btnDownload.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) { showMsg('Please enter a URL first.', 'error'); return; }

  await startDownload({
    url,
    type:    'video',
    format:  selFormat.value,
    quality: selQuality.value,
    embed:   chkEmbed.checked,
    downloadPath: pathInput.value.trim(),
  });
});

// â”€â”€ Download full playlist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
btnPlaylist.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) { showMsg('Please enter a playlist URL.', 'error'); return; }

  const playlistItems = playlistRangeInput.value.trim();

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
      embed:   chkEmbed.checked,
      playlistItems: playlistItems || null,
      downloadPath: pathInput.value.trim(),
    });
  } catch (err) {
    showMsg(err.message, 'error');
  } finally {
    btnPlaylist.disabled = false;
    btnPlaylist.textContent = 'â–¶â–¶ Full Playlist';
  }
});

selFormat.addEventListener('change', updateQualityForFormat);

// â”€â”€ Toggle range visibility on URL input change â”€â”€
urlInput.addEventListener('input', updateRangeInputVisibility);

// â”€â”€ Open Folder click listener â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
btnOpenFolder.addEventListener('click', async () => {
  try {
    const res = await fetch(`${BACKEND}/open-folder`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ downloadPath: pathInput.value.trim() }),
    });
    if (res.ok) {
      showMsg('Downloads folder opened.', 'success');
    } else throw new Error();
  } catch {
    showMsg('Failed to open downloads folder. Start server first.', 'error');
  }
});

// â”€â”€ Save download path on input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
pathInput.addEventListener('input', async () => {
  await chrome.storage.local.set({ downloadPath: pathInput.value.trim() });
});

// â”€â”€ Grab detected URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
btnGrab.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) return;
  // Treat as playlist download
  btnPlaylist.click();
});

// â”€â”€ Core: start download via background â”€â”€â”€â”€â”€â”€â”€
async function startDownload(job) {
  const id = Date.now().toString();
  const item = {
    id,
    ...job,
    status: 'queued',
    progress: 0,
    speed: null,
    downloaded: 0,
    total: job.count || job.total || null,
  };

  queue.push(item);
  await saveQueue();
  renderQueue();
  showMsg(`Added to queue: ${job.type === 'playlist' ? job.title || 'Playlist' : 'Video'}`, 'success');

  // Tell background service worker to handle it
  chrome.runtime.sendMessage({ action: 'startDownload', job: { id, ...job } });
}

// â”€â”€ Cancel a running job on the backend â”€â”€â”€â”€â”€
async function cancelJob(id) {
  try {
    await fetch(`${BACKEND}/cancel/${id}`, { method: 'POST' });
  } catch {
    // Backend might be offline or already stopped
  }
}

// â”€â”€ Queue persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadQueue() {
  const data = await chrome.storage.local.get(['queue', 'downloadPath']);
  queue = data.queue || [];
  if (data.downloadPath) {
    pathInput.value = data.downloadPath;
  }
  renderQueue();
}

async function saveQueue() {
  await chrome.storage.local.set({ queue });
}

// â”€â”€ Sync queue status from backend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function syncQueueWithBackend() {
  if (!backendOnline || queue.length === 0) return;

  try {
    const res = await fetch(`${BACKEND}/jobs`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return;
    const jobs = await res.json();

    let changed = false;
    for (const item of queue) {
      const job = jobs[item.id];
      if (!job) continue;

      if (job.status && job.status !== item.status) {
        item.status = job.status;
        changed = true;
      }

      if (Number.isFinite(job.progress)) {
        const nextProgress = Math.round(job.progress);
        if (nextProgress !== item.progress) {
          item.progress = nextProgress;
          changed = true;
        }
      }

      if (Number.isFinite(job.downloaded) && job.downloaded !== item.downloaded) {
        item.downloaded = job.downloaded;
        changed = true;
      }

      if (Number.isFinite(job.total) && job.total !== item.total) {
        item.total = job.total;
        if (!item.count) item.count = job.total;
        changed = true;
      }

      if (Number.isFinite(job.speed) && job.speed !== item.speed) {
        item.speed = job.speed;
        changed = true;
      }

      if (job.status === 'done' && item.progress !== 100) {
        item.progress = 100;
        changed = true;
      }
    }

    if (changed) {
      await saveQueue();
      renderQueue();
    }
  } catch {
    // Backend might be offline or busy
  }
}

function startQueueSync() {
  if (syncTimer) return;
  syncTimer = setInterval(syncQueueWithBackend, 2000);
}

// â”€â”€ Render queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderQueue() {
  queueCount.textContent = `${queue.length} item${queue.length !== 1 ? 's' : ''}`;

  if (queue.length === 0) {
    queueList.innerHTML = `
      <div class="queue-empty">
        <span class="queue-empty-icon">ðŸ“‚</span>
        No downloads yet
      </div>`;
    return;
  }

  queueList.innerHTML = queue.map(item => {
    const isAudio = item.format === 'mp3';
    const icon = item.type === 'playlist'
      ? (isAudio ? 'ðŸŽµ' : 'ðŸŽ¬')
      : (isAudio ? 'ðŸŽµ' : 'ðŸŽ¬');
    const speedText = item.speed ? formatSpeed(item.speed) : '';
    const totalVideos = item.type === 'playlist' ? (item.total || item.count) : null;
    const downloaded = Number.isFinite(item.downloaded) ? item.downloaded : 0;
    const displayDownloaded = item.status === 'done' && totalVideos ? totalVideos : downloaded;
    const remaining = totalVideos ? Math.max(totalVideos - displayDownloaded, 0) : null;

    const leftText = item.type === 'playlist'
      ? `${displayDownloaded}/${totalVideos || '?'} videos${remaining !== null ? ` â€¢ ${remaining} remaining` : ''}`
      : (speedText || '');
    const rightText = item.type === 'playlist'
      ? `${item.progress}%${speedText ? ` â€¢ ${speedText}` : ''}`
      : `${item.progress}%${speedText ? ` â€¢ ${speedText}` : ''}`;

    let actionBtn = '';
    if (item.status === 'downloading' || item.status === 'queued') {
      actionBtn = `<button class="q-btn btn-pause" type="button" data-id="${item.id}" title="Pause">â¸</button>`;
    } else if (item.status === 'paused') {
      actionBtn = `<button class="q-btn btn-resume" type="button" data-id="${item.id}" title="Resume">â–¶</button>`;
    }

    return `
    <div class="q-item" id="qi-${item.id}">
      <div class="q-top">
        <span class="q-icon">${icon}</span>
        <span class="q-name">${item.title || item.url}</span>
        <span class="q-badge ${item.status}">${badgeText(item)}</span>
        <div style="display: flex; align-items: center; gap: 4px;">
          ${actionBtn}
          <button class="q-remove" type="button" data-id="${item.id}">âœ•</button>
        </div>
      </div>
      ${item.status === 'downloading' || item.status === 'done' || item.status === 'canceled' || item.status === 'paused' ? `
        <div class="q-progress-wrap">
          <div class="q-progress-bar" style="width:${item.progress}%"></div>
        </div>
        <div class="q-sub">
          <span>${leftText}</span>
          <span>${rightText}</span>
        </div>` : ''}
    </div>
  `;
  }).join('');
}

function badgeText(item) {
  if (item.status === 'downloading') return 'Downloading';
  if (item.status === 'done')        return 'âœ“ Done';
  if (item.status === 'error')       return 'âœ— Error';
  if (item.status === 'canceled')    return 'Canceled';
  if (item.status === 'paused')      return 'Paused';
  if (item.type   === 'playlist')    return 'Playlist';
  return 'Queued';
}

function formatSpeed(speed) {
  const val = Number(speed);
  if (!Number.isFinite(val) || val <= 0) return '';
  return `${val.toFixed(2)} MB/s`;
}

// â”€â”€ Remove item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleRemove(id) {
  const item = queue.find(i => i.id === id);
  if (!item) return;

  if (item.status === 'downloading' || item.status === 'queued') {
    await cancelJob(id);
    item.status = 'canceled';
    item.speed = null;
    await saveQueue();
    renderQueue();
    return;
  }

  queue = queue.filter(i => i.id !== id);
  await saveQueue();
  renderQueue();
}

async function pauseJob(id) {
  try {
    const res = await fetch(`${BACKEND}/pause/${id}`, { method: 'POST' });
    if (res.ok) {
      const item = queue.find(i => i.id === id);
      if (item) {
        item.status = 'paused';
        item.speed = null;
        await saveQueue();
        renderQueue();
        showMsg('Download paused.', 'success');
      }
    }
  } catch {
    showMsg('Failed to pause download.', 'error');
  }
}

async function resumeJob(id) {
  try {
    const res = await fetch(`${BACKEND}/resume/${id}`, { method: 'POST' });
    if (res.ok) {
      const item = queue.find(i => i.id === id);
      if (item) {
        item.status = 'queued';
        item.speed = null;
        item.progress = item.progress || 0;
        await saveQueue();
        renderQueue();
        showMsg('Download resumed.', 'success');
        
        // Tell background SW to handle download polling again
        chrome.runtime.sendMessage({ action: 'startDownload', job: item });
      }
    }
  } catch {
    showMsg('Failed to resume download.', 'error');
  }
}

queueList.addEventListener('click', async (event) => {
  const removeBtn = event.target.closest('.q-remove');
  if (removeBtn) {
    const id = removeBtn.dataset.id;
    if (id) await handleRemove(id);
    return;
  }

  const pauseBtn = event.target.closest('.btn-pause');
  if (pauseBtn) {
    const id = pauseBtn.dataset.id;
    if (id) await pauseJob(id);
    return;
  }

  const resumeBtn = event.target.closest('.btn-resume');
  if (resumeBtn) {
    const id = resumeBtn.dataset.id;
    if (id) await resumeJob(id);
    return;
  }
});

// â”€â”€ Clear all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
btnClear.addEventListener('click', async () => {
  queue = [];
  await saveQueue();
  renderQueue();
});

// â”€â”€ Listen for progress updates from background
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === 'progress') {
    const item = queue.find(i => i.id === msg.id);
    if (!item) return;
    item.status     = msg.status;
    if (Number.isFinite(msg.progress)) item.progress = Math.round(msg.progress);
    if (Number.isFinite(msg.downloaded)) item.downloaded = msg.downloaded;
    if (Number.isFinite(msg.speed)) item.speed = msg.speed;
    if (Number.isFinite(msg.total)) {
      item.total = msg.total;
      if (!item.count) item.count = msg.total;
    }
    if (msg.status === 'done') item.progress = 100;
    await saveQueue();
    renderQueue();
  }
});

// â”€â”€ Show message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showMsg(text, type = 'info') {
  msgBox.textContent  = text;
  msgBox.className    = type;
  clearTimeout(msgBox._t);
  if (type !== 'error') {
    msgBox._t = setTimeout(() => { msgBox.className = ''; }, 4000);
  }
}

// â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
init();

