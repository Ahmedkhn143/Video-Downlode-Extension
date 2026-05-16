// ─────────────────────────────────────────────
//  PlaylistGet — server.js
//  Local Node.js backend (runs on localhost:7474)
//  Handles download requests from the extension
// ─────────────────────────────────────────────
//
//  HOW TO RUN:
//    npm install
//    node server.js
//
// ─────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const os      = require('os');

const downloader = require('./downloader');

const app  = express();
const PORT = 7474;

// ── Middleware ────────────────────────────────
app.use(cors({ origin: '*' })); // Allow Chrome extension
app.use(express.json());

// ── In-memory job tracker ─────────────────────
// Stores progress for each download job
const jobs = {}; // { [id]: { status, progress, downloaded, total } }

// ── Routes ────────────────────────────────────

// Health check
app.get('/ping', (req, res) => {
  res.json({ ok: true, version: '1.0.0' });
});

// ── Get playlist info (title + video count) ───
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

// ── Download single video ─────────────────────
app.post('/download', async (req, res) => {
  const { id, url, format, quality } = req.body;
  if (!id || !url) return res.status(400).json({ error: 'id and url are required' });

  // Initialize job tracker
  jobs[id] = { status: 'downloading', progress: 0, downloaded: 0 };

  // Start download in background (don't await — respond immediately)
  downloader.downloadVideo({ id, url, format, quality }, (update) => {
    if (jobs[id]?.status === 'canceled') return;
    jobs[id] = { ...jobs[id], ...update };
  }).then(() => {
    if (jobs[id]?.status === 'canceled') return;
    jobs[id].status   = 'done';
    jobs[id].progress = 100;
  }).catch((err) => {
    if (jobs[id]?.status === 'canceled') return;
    jobs[id].status = 'error';
    jobs[id].error  = err.message;
    console.error(`[Job ${id}] Error:`, err.message);
  });

  // Immediately tell extension: "started"
  res.json({ ok: true, id });
});

// ── Download full playlist ────────────────────
app.post('/download-playlist', async (req, res) => {
  const { id, url, format, quality } = req.body;
  if (!id || !url) return res.status(400).json({ error: 'id and url are required' });

  jobs[id] = { status: 'downloading', progress: 0, downloaded: 0, total: 0 };

  // Start playlist download in background
  downloader.downloadPlaylist({ id, url, format, quality }, (update) => {
    if (jobs[id]?.status === 'canceled') return;
    jobs[id] = { ...jobs[id], ...update };
  }).then(() => {
    if (jobs[id]?.status === 'canceled') return;
    jobs[id].status   = 'done';
    jobs[id].progress = 100;
  }).catch((err) => {
    if (jobs[id]?.status === 'canceled') return;
    jobs[id].status = 'error';
    jobs[id].error  = err.message;
    console.error(`[Playlist Job ${id}] Error:`, err.message);
  });

  res.json({ ok: true, id });
});

// ── Cancel a running download ─────────────────
app.post('/cancel/:id', (req, res) => {
  const { id } = req.params;
  const job = jobs[id];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  downloader.cancelDownload(id);
  jobs[id] = { ...job, status: 'canceled' };
  res.json({ ok: true, id });
});

// ── Get progress for a job ────────────────────
app.get('/progress/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── List all active jobs ──────────────────────
app.get('/jobs', (req, res) => {
  res.json(jobs);
});

// ── Start server ──────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────┐');
  console.log('  │   PlaylistGet Backend  v1.0.0         │');
  console.log(`  │   Running on http://localhost:${PORT}   │`);
  console.log('  │   Downloads → ' + path.join(os.homedir(), 'Downloads').padEnd(22) + '│');
  console.log('  └──────────────────────────────────────┘');
  console.log('');
});
