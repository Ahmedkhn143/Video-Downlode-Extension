// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  NexDown â€” server.js
//  Local Node.js backend (runs on localhost:7474)
//  Handles download requests from the extension
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
//  HOW TO RUN:
//    npm install
//    node server.js
//
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const os      = require('os');

const downloader = require('./downloader');

const app  = express();
const PORT = 7474;

// â”€â”€ Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(cors({ origin: '*' })); // Allow Chrome extension
app.use(express.json());

// â”€â”€ In-memory job tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Stores progress for each download job
const jobs = {}; // { [id]: { status, progress, downloaded, total, type, url, ... } }

// â”€â”€ Queue Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const downloadQueue = []; // Array of job IDs waiting to be downloaded
let activeCount = 0;
const MAX_CONCURRENT = 2; // Concurrency limit

function processNext() {
  if (activeCount >= MAX_CONCURRENT) return;
  if (downloadQueue.length === 0) return;

  const nextJobId = downloadQueue.shift();
  const jobParams = jobs[nextJobId];

  if (!jobParams || jobParams.status === 'canceled') {
    // Skip if job doesn't exist or was canceled
    processNext();
    return;
  }

  activeCount++;
  jobParams.status = 'downloading';
  jobParams.progress = 5; // progress started

  console.log(`[Queue] Starting Job ${nextJobId}. Active: ${activeCount}`);

  const downloadFn = jobParams.type === 'playlist' 
    ? downloader.downloadPlaylist 
    : downloader.downloadVideo;

  downloadFn({
    id: nextJobId,
    url: jobParams.url,
    format: jobParams.format,
    quality: jobParams.quality,
    embed: jobParams.embed,
    playlistItems: jobParams.playlistItems,
    downloadPath: jobParams.downloadPath
  }, (update) => {
    if (jobs[nextJobId]?.status === 'canceled') return;
    jobs[nextJobId] = { ...jobs[nextJobId], ...update };
  }).then(() => {
    if (jobs[nextJobId]?.status === 'canceled') return;
    jobs[nextJobId].status = 'done';
    jobs[nextJobId].progress = 100;
  }).catch((err) => {
    if (jobs[nextJobId]?.status === 'canceled') return;
    jobs[nextJobId].status = 'error';
    jobs[nextJobId].error = err.message;
    console.error(`[Job ${nextJobId}] Error:`, err.message);
  }).finally(() => {
    activeCount--;
    console.log(`[Queue] Job ${nextJobId} finished. Active: ${activeCount}`);
    processNext();
  });
}

// â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Health check
app.get('/ping', (req, res) => {
  res.json({ ok: true, version: '1.0.0' });
});

// â”€â”€ Open downloads folder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/open-folder', (req, res) => {
  const { downloadPath } = req.body;
  try {
    downloader.openDownloadsFolder(downloadPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ Get playlist info (title + video count) â”€â”€â”€
app.post('/playlist-info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const info = await downloader.getPlaylistInfo(url);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ Download single video â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/download', (req, res) => {
  const { id, url, format, quality, embed, downloadPath } = req.body;
  if (!id || !url) return res.status(400).json({ error: 'id and url are required' });

  // Initialize job tracker with queued status
  jobs[id] = {
    id,
    type: 'video',
    url,
    format,
    quality,
    embed,
    downloadPath,
    status: 'queued',
    progress: 0,
    downloaded: 0,
    speed: null,
    total: null
  };

  downloadQueue.push(id);
  res.json({ ok: true, id });

  processNext();
});

// â”€â”€ Download full playlist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/download-playlist', (req, res) => {
  const { id, url, format, quality, embed, playlistItems, downloadPath } = req.body;
  if (!id || !url) return res.status(400).json({ error: 'id and url are required' });

  jobs[id] = {
    id,
    type: 'playlist',
    url,
    format,
    quality,
    embed,
    playlistItems,
    downloadPath,
    status: 'queued',
    progress: 0,
    downloaded: 0,
    speed: null,
    total: null
  };

  downloadQueue.push(id);
  res.json({ ok: true, id });

  processNext();
});

// â”€â”€ Cancel a running download â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/cancel/:id', (req, res) => {
  const { id } = req.params;
  const job = jobs[id];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'downloading') {
    downloader.cancelDownload(id);
  } else {
    // Remove from wait queue if not yet active
    const qIndex = downloadQueue.indexOf(id);
    if (qIndex > -1) {
      downloadQueue.splice(qIndex, 1);
    }
  }

  jobs[id] = { ...job, status: 'canceled', speed: null };
  res.json({ ok: true, id });
});

// â”€â”€ Pause a running download â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/pause/:id', (req, res) => {
  const { id } = req.params;
  const job = jobs[id];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'downloading') {
    downloader.cancelDownload(id);
  } else {
    // Remove from wait queue if not yet active
    const qIndex = downloadQueue.indexOf(id);
    if (qIndex > -1) {
      downloadQueue.splice(qIndex, 1);
    }
  }

  jobs[id] = { ...job, status: 'paused', speed: null };
  res.json({ ok: true, id });
});

// â”€â”€ Resume a paused download â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/resume/:id', (req, res) => {
  const { id } = req.params;
  const job = jobs[id];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status !== 'paused' && job.status !== 'canceled') {
    return res.status(400).json({ error: 'Job is not paused or canceled' });
  }

  // Put back in queue
  jobs[id] = { ...job, status: 'queued', speed: null, error: null };
  downloadQueue.push(id);
  res.json({ ok: true, id });

  processNext();
});

// â”€â”€ Get progress for a job â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/progress/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// â”€â”€ List all active jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/jobs', (req, res) => {
  res.json(jobs);
});

// â”€â”€ Start server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.listen(PORT, () => {
  console.log('');
  console.log('  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”');
  console.log('  â”‚   NexDown Backend  v1.0.0         â”‚');
  console.log(`  â”‚   Running on http://localhost:${PORT}   â”‚`);
  console.log('  â”‚   Downloads â†’ ' + path.join(os.homedir(), 'Downloads').padEnd(22) + 'â”‚');
  console.log('  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜');
  console.log('');
});

