// ─────────────────────────────────────────────
//  PlaylistGet — downloader.js
//  Wraps yt-dlp CLI to download videos & playlists
//
//  REQUIREMENT: yt-dlp must be installed
//    Windows : winget install yt-dlp.yt-dlp
//    Mac/Linux: pip install yt-dlp
//              OR brew install yt-dlp
// ─────────────────────────────────────────────

const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');

// Ensure winget shims are on PATH for yt-dlp/ffmpeg.
function addToPath(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  process.env.PATH = process.env.PATH || '';
  const parts = process.env.PATH.split(';');
  if (!parts.includes(dir)) {
    process.env.PATH = `${dir};${process.env.PATH}`;
  }
}

function findFirstDir(parent, prefix) {
  if (!parent || !fs.existsSync(parent)) return null;
  const entry = fs.readdirSync(parent, { withFileTypes: true })
    .find((item) => item.isDirectory() && item.name.startsWith(prefix));
  return entry ? path.join(parent, entry.name) : null;
}

function findFileRecursive(root, fileName, maxDepth = 3) {
  if (!root || !fs.existsSync(root) || maxDepth < 0) return null;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName) return full;
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, fileName, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}

const wingetLinks = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')
  : null;
addToPath(wingetLinks);

let ytDlpBin = null;
let ffmpegBinDir = null;
if (wingetLinks && fs.existsSync(wingetLinks)) {
  const ytDlpLink = path.join(wingetLinks, 'yt-dlp.exe');
  if (fs.existsSync(ytDlpLink)) ytDlpBin = ytDlpLink;
  const ffmpegLink = path.join(wingetLinks, 'ffmpeg.exe');
  if (fs.existsSync(ffmpegLink)) ffmpegBinDir = wingetLinks;
}

const wingetPkgs = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
  : null;
if (wingetPkgs && fs.existsSync(wingetPkgs)) {
  const ffmpegRoot = findFirstDir(wingetPkgs, 'yt-dlp.FFmpeg_');
  if (ffmpegRoot && !ffmpegBinDir) {
    const ffmpegDir = findFirstDir(ffmpegRoot, 'ffmpeg-');
    if (ffmpegDir) ffmpegBinDir = path.join(ffmpegDir, 'bin');
  }

  if (!ytDlpBin) {
    const ytDlpRoot = findFirstDir(wingetPkgs, 'yt-dlp.yt-dlp_');
    if (ytDlpRoot) {
      ytDlpBin = findFileRecursive(ytDlpRoot, 'yt-dlp.exe', 4);
    }
  }
}

addToPath(ffmpegBinDir);
if (ytDlpBin) addToPath(path.dirname(ytDlpBin));

const YTDLP_BIN = process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)
  ? process.env.YTDLP_PATH
  : ytDlpBin;
const FFMPEG_DIR = process.env.FFMPEG_LOCATION && fs.existsSync(process.env.FFMPEG_LOCATION)
  ? process.env.FFMPEG_LOCATION
  : ffmpegBinDir;

function spawnYtDlp(args) {
  const bin = YTDLP_BIN || 'yt-dlp';
  return spawn(bin, args, { windowsHide: true });
}

function withFfmpeg(args) {
  return FFMPEG_DIR ? ['--ffmpeg-location', FFMPEG_DIR, ...args] : args;
}

// ── Download folder (~/Downloads by default) ──
const DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'PlaylistGet');

const CONCURRENT_FRAGMENTS = Number.parseInt(
  process.env.YTDLP_CONCURRENT_FRAGMENTS || '8',
  10
);
const CONCURRENT_ARGS = Number.isFinite(CONCURRENT_FRAGMENTS) && CONCURRENT_FRAGMENTS > 1
  ? ['--concurrent-fragments', String(CONCURRENT_FRAGMENTS)]
  : [];

const activeJobs = new Map();

function speedToMBps(value, unit) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const u = unit.toLowerCase();
  if (u === 'b') return num / 1_000_000;
  if (u === 'kb') return (num * 1000) / 1_000_000;
  if (u === 'kib') return (num * 1024) / 1_000_000;
  if (u === 'mb') return num;
  if (u === 'mib') return (num * 1024 * 1024) / 1_000_000;
  if (u === 'gb') return (num * 1_000_000_000) / 1_000_000;
  if (u === 'gib') return (num * 1024 * 1024 * 1024) / 1_000_000;
  return null;
}

function parseSpeedMB(line) {
  const match = line.match(/\bat\s+([\d.]+)\s*([KMG]?i?B)\/s/i);
  if (!match) return null;
  const mbps = speedToMBps(match[1], match[2]);
  if (!Number.isFinite(mbps)) return null;
  return Math.round(mbps * 100) / 100;
}

// ── Map quality to yt-dlp format string ───────
function buildFormatArg(format, quality) {
  if (format === 'mp3') {
    return ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0'];
  }

  const qualityMap = {
    best:  'bestvideo+bestaudio/best',
    2160:  'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
    1080:  'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
    720:   'bestvideo[height<=720]+bestaudio/best[height<=720]',
    480:   'bestvideo[height<=480]+bestaudio/best[height<=480]',
    360:   'bestvideo[height<=360]+bestaudio/best[height<=360]',
  };

  const fmt = qualityMap[quality] || qualityMap.best;
  const ext = format === 'webm' ? 'webm' : 'mp4';

  return ['--format', fmt, '--merge-output-format', ext];
}

// ── Get playlist info (title + count) ─────────
function getPlaylistInfo(url) {
  return new Promise((resolve, reject) => {
    // yt-dlp --flat-playlist --print "%(playlist_title)s" --print "%(n_entries)s"
    const args = withFfmpeg([
      '--flat-playlist',
      '--no-warnings',
      '--no-download',
      '-J',       // dump JSON (gives us full playlist metadata)
      url,
    ]);

    const proc   = spawnYtDlp(args);
    let   stdout = '';
    let   stderr = '';

    let settled = false;

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        return reject(new Error(stderr.trim() || 'yt-dlp failed to fetch playlist info'));
      }
      try {
        const data  = JSON.parse(stdout);
        const title = data.title || data.playlist_title || 'Playlist';
        const count = data.entries ? data.entries.length : (data.playlist_count || 0);
        resolve({ title, count });
      } catch {
        reject(new Error('Failed to parse playlist info from yt-dlp'));
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp not found. Install it or set YTDLP_PATH.'));
      } else {
        reject(err);
      }
    });
  });
}

// ── Download single video ─────────────────────
function downloadVideo({ id, url, format = 'mp4', quality = 'best' }, onProgress) {
  return new Promise((resolve, reject) => {
    const formatArgs = buildFormatArg(format, quality);

    const args = withFfmpeg([
      ...formatArgs,
      ...CONCURRENT_ARGS,
      '--no-warnings',
      '--newline',                    // one line per progress update
      '-o', path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s'),
      url,
    ]);

    console.log(`[Job ${id}] Starting: yt-dlp`, args.join(' '));
    const proc = spawnYtDlp(args);
    activeJobs.set(id, proc);

    let lastSpeed = null;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const speed = parseSpeedMB(line);
        if (speed !== null) lastSpeed = speed;

        // Parse yt-dlp progress: "[download]  45.3% of 120.50MiB ..."
        const match = line.match(/\[download\]\s+([\d.]+)%/);
        if (match) {
          const progress = Math.round(parseFloat(match[1]));
          onProgress({ status: 'downloading', progress, speed: lastSpeed });
        }
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`[Job ${id}] stderr:`, data.toString().trim());
    });

    proc.on('close', (code) => {
      activeJobs.delete(id);
      if (code === 0) {
        onProgress({ status: 'done', progress: 100 });
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      activeJobs.delete(id);
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp not found. Install it or set YTDLP_PATH.'));
      } else {
        reject(err);
      }
    });
  });
}

// ── Download full playlist ────────────────────
function downloadPlaylist({ id, url, format = 'mp4', quality = 'best' }, onProgress) {
  return new Promise((resolve, reject) => {
    const formatArgs = buildFormatArg(format, quality);

    // Save each video in its own playlist subfolder
    const outputTemplate = path.join(
      DOWNLOAD_DIR,
      '%(playlist_title)s',
      '%(playlist_index)02d - %(title)s.%(ext)s'
    );

    const args = withFfmpeg([
      ...formatArgs,
      ...CONCURRENT_ARGS,
      '--yes-playlist',
      '--no-warnings',
      '--newline',
      '-o', outputTemplate,
      url,
    ]);

    console.log(`[Playlist Job ${id}] Starting: yt-dlp`, args.join(' '));
    const proc = spawnYtDlp(args);
    activeJobs.set(id, proc);

    let totalVideos     = 0;
    let downloadedCount = 0;
    let lastSpeed = null;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {

        const speed = parseSpeedMB(line);
        if (speed !== null) lastSpeed = speed;

        // Detect "Downloading video X of Y"
        const videoMatch = line.match(/Downloading video (\d+) of (\d+)/i);
        if (videoMatch) {
          downloadedCount = parseInt(videoMatch[1]);
          totalVideos     = parseInt(videoMatch[2]);
        }

        // Detect percentage progress for current video
        const pctMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (pctMatch && totalVideos > 0) {
          const videoProgress = parseFloat(pctMatch[1]);
          // Overall progress = (completed videos + current video %) / total
          const overall = Math.round(
            ((downloadedCount - 1 + videoProgress / 100) / totalVideos) * 100
          );
          onProgress({
            status:     'downloading',
            progress:   Math.min(overall, 99),
            downloaded: downloadedCount,
            total:      totalVideos,
            speed:      lastSpeed,
          });
        }
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`[Playlist Job ${id}] stderr:`, data.toString().trim());
    });

    proc.on('close', (code) => {
      activeJobs.delete(id);
      if (code === 0) {
        onProgress({ status: 'done', progress: 100, downloaded: totalVideos, total: totalVideos });
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      activeJobs.delete(id);
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp not found. Install it or set YTDLP_PATH.'));
      } else {
        reject(err);
      }
    });
  });
}

function cancelDownload(id) {
  const proc = activeJobs.get(id);
  if (!proc) return false;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
  } else {
    proc.kill('SIGTERM');
  }
  activeJobs.delete(id);
  return true;
}

module.exports = { getPlaylistInfo, downloadVideo, downloadPlaylist, cancelDownload };
