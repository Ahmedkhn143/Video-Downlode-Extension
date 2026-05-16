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
const path       = require('path');
const os         = require('os');

// ── Download folder (~/Downloads by default) ──
const DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'PlaylistGet');

// ── Map quality to yt-dlp format string ───────
function buildFormatArg(format, quality) {
  if (format === 'mp3') {
    return ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0'];
  }

  const qualityMap = {
    best:  'bestvideo+bestaudio/best',
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
    const args = [
      '--flat-playlist',
      '--no-warnings',
      '--no-download',
      '-J',       // dump JSON (gives us full playlist metadata)
      url,
    ];

    const proc   = spawn('yt-dlp', args);
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
        reject(new Error('yt-dlp not found. Install it: pip install yt-dlp'));
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

    const args = [
      ...formatArgs,
      '--no-warnings',
      '--newline',                    // one line per progress update
      '-o', path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s'),
      url,
    ];

    console.log(`[Job ${id}] Starting: yt-dlp`, args.join(' '));
    const proc = spawn('yt-dlp', args);

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      // Parse yt-dlp progress: "[download]  45.3% of 120.50MiB ..."
      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        const progress = Math.round(parseFloat(match[1]));
        onProgress({ status: 'downloading', progress });
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`[Job ${id}] stderr:`, data.toString().trim());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        onProgress({ status: 'done', progress: 100 });
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp not found. Install it: pip install yt-dlp'));
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

    const args = [
      ...formatArgs,
      '--yes-playlist',
      '--no-warnings',
      '--newline',
      '-o', outputTemplate,
      url,
    ];

    console.log(`[Playlist Job ${id}] Starting: yt-dlp`, args.join(' '));
    const proc = spawn('yt-dlp', args);

    let totalVideos    = 0;
    let downloadedCount = 0;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {

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
          });
        }
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`[Playlist Job ${id}] stderr:`, data.toString().trim());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        onProgress({ status: 'done', progress: 100, downloaded: totalVideos, total: totalVideos });
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp not found. Install it: pip install yt-dlp'));
      } else {
        reject(err);
      }
    });
  });
}

module.exports = { getPlaylistInfo, downloadVideo, downloadPlaylist };
