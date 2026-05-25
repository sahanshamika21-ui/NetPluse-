const ALARM_NAME = 'z-pinger-cycle';
const HISTORY_LIMIT = 100;
const BOOST_COOLDOWN_MS = 30000;
const DEFAULT_STATE = {
  isRunning: false,
  profile: 'youtube',
  intervalSeconds: 60,
  burstCount: 1,
  timeoutMs: 5500,
  youtubeBoost: true,
  boostIntervalSeconds: 30,
  customUrls: [],
  youtube: {
    active: false,
    playing: false,
    buffering: false,
    lastEvent: 'none',
    lastTitle: '',
    lastUrl: '',
    lastSeenAt: null,
    boostCount: 0,
    stallCount: 0
  },
  stats: {
    cycles: 0,
    probes: 0,
    success: 0,
    failed: 0,
    currentStreak: 0,
    worstStreak: 0,
    avgRtt: null,
    lastStatus: 'idle',
    lastRunAt: null
  },
  history: []
};

const PROFILES = {
  dialog: [
    { name: 'Dialog Selfcare', url: 'https://selfcare.dialog.lk/favicon.ico' },
    { name: 'Dialog Web', url: 'https://www.dialog.lk/favicon.ico' },
    { name: 'Google 204', url: 'https://www.gstatic.com/generate_204' },
    { name: 'YouTube 204', url: 'https://www.youtube.com/generate_204' }
  ],
  hutch: [
    { name: 'Hutch OneApp', url: 'https://oneapp.hutch.lk/favicon.ico' },
    { name: 'Google 204', url: 'https://www.gstatic.com/generate_204' },
    { name: 'Cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace' }
  ],
  mobitel: [
    { name: 'Mobitel Selfcare', url: 'https://mas.mobitel.lk/favicon.ico' },
    { name: 'SLT-Mobitel Web', url: 'https://www.mobitel.lk/favicon.ico' },
    { name: 'Google 204', url: 'https://www.gstatic.com/generate_204' }
  ],
  airtel: [
    { name: 'Airtel Selfcare', url: 'https://my.airtel.lk/favicon.ico' },
    { name: 'Airtel Web', url: 'https://www.airtel.lk/favicon.ico' },
    { name: 'Google 204', url: 'https://www.gstatic.com/generate_204' }
  ],
  slt: [
    { name: 'SLT Web', url: 'https://www.slt.lk/favicon.ico' },
    { name: 'Google 204', url: 'https://www.gstatic.com/generate_204' },
    { name: 'Cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace' }
  ],
  balanced: [
    { name: 'Google 204', url: 'https://www.gstatic.com/generate_204' },
    { name: 'Cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace' },
    { name: '1.1.1.1', url: 'https://one.one.one.one/cdn-cgi/trace' }
  ],
  youtube: [
    { name: 'YouTube 204', url: 'https://www.youtube.com/generate_204' },
    { name: 'YouTube Image CDN', url: 'https://i.ytimg.com/generate_204' },
    { name: 'Google 204', url: 'https://www.gstatic.com/generate_204' },
    { name: 'Google Web', url: 'https://www.google.com/generate_204' }
  ],
  custom: []
};

const BOOST_ENDPOINTS = [
  { name: 'Gstatic Rescue', url: 'https://www.gstatic.com/generate_204' }
];

let lastBoostAt = 0;

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await chrome.storage.local.set({ state: normalizeState({ ...DEFAULT_STATE, ...state }) });
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state.isRunning) await scheduleAlarm(state.intervalSeconds);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runCycle('scheduled');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message, sender) {
  if (message.type === 'GET_STATE') {
    return { state: await getState(), profiles: PROFILES };
  }

  if (message.type === 'START') {
    const state = await saveState({ isRunning: true });
    await scheduleAlarm(state.intervalSeconds);
    runCycle('start');
    return { ok: true, state };
  }

  if (message.type === 'STOP') {
    await chrome.alarms.clear(ALARM_NAME);
    const state = await saveState({
      isRunning: false,
      statsPatch: { lastStatus: 'idle' },
      youtubePatch: { active: false, playing: false, buffering: false, lastEvent: 'stopped' }
    });
    return { ok: true, state };
  }

  if (message.type === 'SAVE_SETTINGS') {
    const next = normalizeSettings(message.settings || {});
    const state = await saveState(next);
    if (state.isRunning) await scheduleAlarm(state.intervalSeconds);
    return { ok: true, state };
  }

  if (message.type === 'PING_NOW') {
    const state = await runCycle('manual');
    return { ok: true, state };
  }

  if (message.type === 'YOUTUBE_HEARTBEAT') {
    await updateYoutubeState(message.payload || {}, sender);
    return { ok: true };
  }

  if (message.type === 'YOUTUBE_STALL') {
    const state = await updateYoutubeState({ ...(message.payload || {}), buffering: true, lastEvent: 'stall' }, sender, true);
    if (state.isRunning && state.youtubeBoost) runBoostCycle('youtube-stall');
    return { ok: true };
  }

  if (message.type === 'RESET_STATS') {
    const state = await saveState({
      stats: DEFAULT_STATE.stats,
      history: [],
      youtubePatch: { boostCount: 0, stallCount: 0 }
    });
    return { ok: true, state };
  }

  return { ok: false, error: 'Unknown message type' };
}

async function scheduleAlarm(intervalSeconds) {
  const periodInMinutes = Math.max(0.5, Number(intervalSeconds || 30) / 60);
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: periodInMinutes,
    periodInMinutes
  });
}

async function runCycle(reason) {
  const state = await getState();
  const endpoints = selectEndpoints(state);
  if (!endpoints.length) {
    const nextState = await mergeResults([], 'youtube-priority');
    chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state: nextState }).catch(() => {});
    return nextState;
  }
  const results = [];

  for (const endpoint of endpoints) {
    results.push(await probeEndpoint(endpoint, state.timeoutMs));
  }

  const nextState = await mergeResults(results, reason || 'scheduled');
  chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state: nextState }).catch(() => {});
  maybeNotify(nextState);
  return nextState;
}

async function runBoostCycle(reason, bypassCooldown = false) {
  const now = Date.now();
  if (!bypassCooldown && now - lastBoostAt < BOOST_COOLDOWN_MS) return getState();
  lastBoostAt = now;

  const state = await getState();
  const endpoints = BOOST_ENDPOINTS.slice(0, 1);
  const results = [];
  for (const endpoint of endpoints) {
    results.push(await probeEndpoint(endpoint, Math.min(state.timeoutMs, 3500)));
  }
  const nextState = await mergeResults(results, reason || 'youtube-boost', { youtubeBoost: true });
  chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state: nextState }).catch(() => {});
  return nextState;
}

function selectEndpoints(state) {
  if (state.youtubeBoost && state.youtube.active && state.youtube.playing && !state.youtube.buffering) {
    return [{ name: 'Gstatic Keepalive', url: 'https://www.gstatic.com/generate_204' }];
  }

  const source = state.profile === 'custom'
    ? urlsToEndpoints(state.customUrls)
    : PROFILES[state.profile] || PROFILES.dialog;
  const profileEndpoints = source.length ? source : PROFILES.dialog;
  const endpoints = profileEndpoints;
  const count = Math.min(Math.max(Number(state.burstCount || 1), 1), endpoints.length);
  const offset = state.stats.cycles % endpoints.length;
  return Array.from({ length: count }, (_, i) => endpoints[(offset + i) % endpoints.length]);
}

function mergeEndpointLists(priority, fallback) {
  const seen = new Set();
  return [...priority, ...fallback].filter((endpoint) => {
    if (seen.has(endpoint.url)) return false;
    seen.add(endpoint.url);
    return true;
  });
}

function urlsToEndpoints(urls) {
  return (urls || [])
    .map((url, index) => ({ name: `Custom ${index + 1}`, url }))
    .filter((endpoint) => /^https?:\/\//i.test(endpoint.url));
}

async function probeEndpoint(endpoint, timeoutMs) {
  const startedAt = Date.now();
  const url = withCacheBust(endpoint.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal
    });
    return {
      ok: true,
      name: endpoint.name,
      url: endpoint.url,
      rtt: Date.now() - startedAt,
      at: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      name: endpoint.name,
      url: endpoint.url,
      rtt: Date.now() - startedAt,
      error: error.name === 'AbortError' ? 'timeout' : (error.message || 'network error'),
      at: new Date().toISOString()
    };
  } finally {
    clearTimeout(timer);
  }
}

function withCacheBust(url) {
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}np=${Date.now().toString(36)}`;
}

async function mergeResults(results, reason, options = {}) {
  const state = await getState();
  const successCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - successCount;
  const successfulRtts = results.filter((result) => result.ok).map((result) => result.rtt);
  const cycleAvg = successfulRtts.length
    ? Math.round(successfulRtts.reduce((sum, rtt) => sum + rtt, 0) / successfulRtts.length)
    : null;
  const skippedCycle = results.length === 0;
  const failedCycle = !skippedCycle && successCount === 0;
  const currentStreak = failedCycle ? state.stats.currentStreak + 1 : 0;
  const avgRtt = cycleAvg == null
    ? state.stats.avgRtt
    : state.stats.avgRtt == null
      ? cycleAvg
      : Math.round((state.stats.avgRtt * 0.72) + (cycleAvg * 0.28));
  const lastRunAt = new Date().toISOString();

  const stats = {
    cycles: state.stats.cycles + 1,
    probes: state.stats.probes + results.length,
    success: state.stats.success + successCount,
    failed: state.stats.failed + failedCount,
    currentStreak,
    worstStreak: Math.max(state.stats.worstStreak, currentStreak),
    avgRtt,
    lastStatus: skippedCycle ? 'ok' : failedCycle ? 'down' : failedCount ? 'degraded' : 'ok',
    lastRunAt
  };

  const youtube = {
    ...state.youtube,
    boostCount: options.youtubeBoost ? state.youtube.boostCount + 1 : state.youtube.boostCount
  };

  const history = [
    {
      at: lastRunAt,
      status: stats.lastStatus,
      reason,
      cycleAvg,
      results
    },
    ...state.history
  ].slice(0, HISTORY_LIMIT);

  return saveState({ stats, history, youtube });
}

async function updateYoutubeState(payload, sender, countStall = false) {
  const state = await getState();
  const youtube = {
    ...state.youtube,
    active: true,
    playing: Boolean(payload.playing),
    buffering: Boolean(payload.buffering),
    lastEvent: payload.lastEvent || state.youtube.lastEvent,
    lastTitle: String(payload.title || state.youtube.lastTitle || '').slice(0, 120),
    lastUrl: String(payload.url || sender?.tab?.url || state.youtube.lastUrl || '').slice(0, 300),
    lastSeenAt: new Date().toISOString(),
    stallCount: countStall ? state.youtube.stallCount + 1 : state.youtube.stallCount
  };
  return saveState({ youtube });
}

async function maybeNotify(state) {
  if (state.stats.currentStreak !== 3) return;
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'Sahan NetPulse: connection unstable',
    message: 'Three probe cycles failed in a row. Your link may be congested or temporarily stalled.'
  });
}

async function getState() {
  const stored = await chrome.storage.local.get('state');
  return normalizeState({ ...DEFAULT_STATE, ...(stored.state || {}) });
}

async function saveState(patch) {
  const current = await getState();
  const next = normalizeState({
    ...current,
    ...patch,
    stats: patch.statsPatch ? { ...current.stats, ...patch.statsPatch } : (patch.stats || current.stats),
    youtube: patch.youtubePatch ? { ...current.youtube, ...patch.youtubePatch } : (patch.youtube || current.youtube),
    history: patch.history || current.history
  });
  delete next.statsPatch;
  delete next.youtubePatch;
  await chrome.storage.local.set({ state: next });
  return next;
}

function normalizeSettings(settings) {
  const customUrls = String(settings.customUrls || '')
    .split(/\s+/)
    .map((url) => url.trim())
    .filter(Boolean);

  return {
    profile: getProfileId(settings.profile),
    intervalSeconds: clamp(Number(settings.intervalSeconds), 30, 300),
    burstCount: clamp(Number(settings.burstCount), 1, 4),
    timeoutMs: clamp(Number(settings.timeoutMs), 2500, 12000),
    boostIntervalSeconds: clamp(Number(settings.boostIntervalSeconds), 30, 180),
    youtubeBoost: Boolean(settings.youtubeBoost),
    customUrls
  };
}

function normalizeState(state) {
  return {
    ...DEFAULT_STATE,
    ...state,
    intervalSeconds: clamp(Number(state.intervalSeconds), 30, 300),
    burstCount: clamp(Number(state.burstCount), 1, 4),
    timeoutMs: clamp(Number(state.timeoutMs), 2500, 12000),
    boostIntervalSeconds: clamp(Number(state.boostIntervalSeconds), 30, 180),
    youtubeBoost: state.youtubeBoost !== false,
    stats: { ...DEFAULT_STATE.stats, ...(state.stats || {}) },
    youtube: { ...DEFAULT_STATE.youtube, ...(state.youtube || {}) },
    history: Array.isArray(state.history) ? state.history.slice(0, HISTORY_LIMIT) : [],
    customUrls: Array.isArray(state.customUrls) ? state.customUrls : []
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function getProfileId(profile) {
  const allowed = ['dialog', 'hutch', 'mobitel', 'airtel', 'slt', 'balanced', 'youtube', 'custom'];
  return allowed.includes(profile) ? profile : DEFAULT_STATE.profile;
}
