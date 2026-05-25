const PRECONNECT_HOSTS = [
  'https://www.youtube.com',
  'https://i.ytimg.com',
  'https://yt3.ggpht.com',
  'https://www.gstatic.com'
];

let lastHeartbeatAt = 0;
let lastStallAt = 0;
let heartbeatTimer = null;
let resourceScanTimer = null;

installPreconnectHints();
bindVideoWatcher();
observePageChanges();
startResourceScanner();

function installPreconnectHints() {
  for (const href of PRECONNECT_HOSTS) {
    addLink('dns-prefetch', href);
    addLink('preconnect', href, true);
  }
}

function startResourceScanner() {
  if (resourceScanTimer) clearInterval(resourceScanTimer);
  scanYouTubeResources();
  resourceScanTimer = setInterval(scanYouTubeResources, 30000);
}

function scanYouTubeResources() {
  const entries = performance.getEntriesByType('resource');
  const hosts = new Set();

  for (let i = entries.length - 1; i >= 0 && hosts.size < 2; i -= 1) {
    try {
      const url = new URL(entries[i].name);
      if (url.hostname.endsWith('googlevideo.com') || url.hostname.endsWith('ytimg.com')) {
        hosts.add(`${url.protocol}//${url.hostname}`);
      }
    } catch (error) {
      // Ignore opaque or malformed resource URLs.
    }
  }

  for (const href of hosts) {
    addLink('dns-prefetch', href);
    addLink('preconnect', href, true);
  }
}

function addLink(rel, href, crossOrigin = false) {
  if (document.querySelector(`link[rel="${rel}"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  if (crossOrigin) link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

function bindVideoWatcher() {
  const video = document.querySelector('video');
  if (!video || video.dataset.netpulseBound === 'true') return;
  video.dataset.netpulseBound = 'true';

  ['play', 'playing', 'ratechange', 'seeking'].forEach((eventName) => {
    video.addEventListener(eventName, () => sendHeartbeat(eventName, video), { passive: true });
  });

  ['waiting', 'stalled', 'suspend', 'error'].forEach((eventName) => {
    video.addEventListener(eventName, () => sendStall(eventName, video), { passive: true });
  });

  video.addEventListener('pause', () => sendHeartbeat('pause', video), { passive: true });
  restartHeartbeatTimer(video);
  sendHeartbeat('bound', video);
}

function restartHeartbeatTimer(video) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!document.hidden) sendHeartbeat('heartbeat', video);
  }, 30000);
}

function sendHeartbeat(eventName, video) {
  const now = Date.now();
  if (now - lastHeartbeatAt < 2500 && eventName === 'heartbeat') return;
  lastHeartbeatAt = now;

  chrome.runtime.sendMessage({
    type: 'YOUTUBE_HEARTBEAT',
    payload: buildPayload(eventName, video)
  }).catch(() => {});
}

function sendStall(eventName, video) {
  const now = Date.now();
  if (now - lastStallAt < 5000) return;
  lastStallAt = now;

  chrome.runtime.sendMessage({
    type: 'YOUTUBE_STALL',
    payload: buildPayload(eventName, video, true)
  }).catch(() => {});
}

function buildPayload(eventName, video, buffering = false) {
  return {
    url: location.href,
    title: document.title,
    playing: Boolean(video && !video.paused && !video.ended),
    buffering: buffering || Boolean(video && video.readyState < 3 && !video.paused),
    currentTime: video ? Math.round(video.currentTime || 0) : 0,
    readyState: video ? video.readyState : 0,
    playbackRate: video ? video.playbackRate : 1,
    lastEvent: eventName
  };
}

function observePageChanges() {
  const observer = new MutationObserver(() => bindVideoWatcher());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', () => {
    installPreconnectHints();
    setTimeout(bindVideoWatcher, 500);
  });
}
