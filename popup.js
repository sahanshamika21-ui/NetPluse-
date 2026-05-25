const toggleBtn = document.getElementById('toggle-btn');
const statusText = document.getElementById('status-text');
const healthStrip = document.getElementById('health-strip');
const healthValue = document.getElementById('health-value');
const rttValue = document.getElementById('rtt-value');
const lossValue = document.getElementById('loss-value');
const profileSelect = document.getElementById('profile-select');
const intervalSelect = document.getElementById('interval-select');
const burstSelect = document.getElementById('burst-select');
const timeoutSelect = document.getElementById('timeout-select');
const youtubeBoostToggle = document.getElementById('youtube-boost-toggle');
const boostIntervalSelect = document.getElementById('boost-interval-select');
const customUrlWrap = document.getElementById('custom-url-wrap');
const customUrlsInput = document.getElementById('custom-urls');
const saveBtn = document.getElementById('save-btn');
const pingNowBtn = document.getElementById('ping-now-btn');
const resetBtn = document.getElementById('reset-btn');
const cyclesValue = document.getElementById('cycles-value');
const okValue = document.getElementById('ok-value');
const failedValue = document.getElementById('failed-value');
const streakValue = document.getElementById('streak-value');
const youtubeStateValue = document.getElementById('youtube-state-value');
const boostCountValue = document.getElementById('boost-count-value');
const stallCountValue = document.getElementById('stall-count-value');
const logList = document.getElementById('log-list');

let state = null;

const PROFILE_PRESETS = {
  youtube: { intervalSeconds: 60, burstCount: 1, youtubeBoost: true, boostIntervalSeconds: 30 },
  dialog: { intervalSeconds: 60, burstCount: 1, youtubeBoost: true, boostIntervalSeconds: 30 },
  hutch: { intervalSeconds: 60, burstCount: 1, youtubeBoost: true, boostIntervalSeconds: 30 },
  mobitel: { intervalSeconds: 60, burstCount: 1, youtubeBoost: true, boostIntervalSeconds: 30 },
  airtel: { intervalSeconds: 60, burstCount: 1, youtubeBoost: true, boostIntervalSeconds: 30 },
  slt: { intervalSeconds: 120, burstCount: 1, youtubeBoost: true, boostIntervalSeconds: 60 },
  balanced: { intervalSeconds: 60, burstCount: 1, youtubeBoost: true, boostIntervalSeconds: 30 },
  custom: { intervalSeconds: 60, burstCount: 1, youtubeBoost: true, boostIntervalSeconds: 30 }
};

init();

async function init() {
  const response = await send({ type: 'GET_STATE' });
  state = response.state;
  render();
}

toggleBtn.addEventListener('click', async () => {
  const response = await send({ type: state.isRunning ? 'STOP' : 'START' });
  state = response.state;
  render();
});

profileSelect.addEventListener('change', () => {
  customUrlWrap.classList.toggle('hidden', profileSelect.value !== 'custom');
  applyProfilePreset(profileSelect.value);
});

saveBtn.addEventListener('click', async () => {
  const response = await send({
    type: 'SAVE_SETTINGS',
    settings: readSettings()
  });
  state = response.state;
  render();
});

pingNowBtn.addEventListener('click', async () => {
  pingNowBtn.disabled = true;
  pingNowBtn.textContent = 'Pinging...';
  try {
    const response = await send({ type: 'PING_NOW' });
    state = response.state;
    render();
  } finally {
    pingNowBtn.disabled = false;
    pingNowBtn.textContent = 'Ping now';
  }
});

resetBtn.addEventListener('click', async () => {
  const response = await send({ type: 'RESET_STATS' });
  state = response.state;
  render();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_UPDATED') {
    state = message.state;
    render();
  }
});

function readSettings() {
  return {
    profile: profileSelect.value,
    intervalSeconds: Number(intervalSelect.value),
    burstCount: Number(burstSelect.value),
    timeoutMs: Number(timeoutSelect.value),
    youtubeBoost: youtubeBoostToggle.checked,
    boostIntervalSeconds: Number(boostIntervalSelect.value),
    customUrls: customUrlsInput.value
  };
}

function applyProfilePreset(profile) {
  const preset = PROFILE_PRESETS[profile];
  if (!preset) return;
  intervalSelect.value = String(preset.intervalSeconds);
  burstSelect.value = String(preset.burstCount);
  youtubeBoostToggle.checked = preset.youtubeBoost;
  boostIntervalSelect.value = String(preset.boostIntervalSeconds);
}

function render() {
  if (!state) return;

  profileSelect.value = state.profile;
  intervalSelect.value = String(state.intervalSeconds);
  burstSelect.value = String(state.burstCount);
  timeoutSelect.value = String(state.timeoutMs);
  youtubeBoostToggle.checked = Boolean(state.youtubeBoost);
  boostIntervalSelect.value = String(state.boostIntervalSeconds);
  customUrlsInput.value = (state.customUrls || []).join('\n');
  customUrlWrap.classList.toggle('hidden', state.profile !== 'custom');

  toggleBtn.classList.toggle('active', state.isRunning);
  toggleBtn.setAttribute('aria-label', state.isRunning ? 'Stop pinger' : 'Start pinger');
  toggleBtn.querySelector('.power-symbol').textContent = state.isRunning ? 'ON' : 'OFF';
  statusText.textContent = state.isRunning ? 'Warming connection' : 'Idle';

  const health = getHealth(state.stats.lastStatus);
  healthStrip.className = `health-strip ${health.className}`;
  healthValue.textContent = health.label;
  rttValue.textContent = state.stats.avgRtt == null ? '--' : `${state.stats.avgRtt} ms`;
  lossValue.textContent = formatLoss(state.stats);

  cyclesValue.textContent = state.stats.cycles;
  okValue.textContent = state.stats.success;
  failedValue.textContent = state.stats.failed;
  streakValue.textContent = state.stats.worstStreak;
  youtubeStateValue.textContent = getYoutubeLabel(state.youtube);
  boostCountValue.textContent = state.youtube.boostCount;
  stallCountValue.textContent = state.youtube.stallCount;

  renderHistory(state.history || []);
}

function renderHistory(history) {
  if (!history.length) {
    logList.innerHTML = '<div class="empty">No probe cycles yet.</div>';
    return;
  }

  logList.innerHTML = '';
  history.slice(0, 12).forEach((cycle) => {
    const row = document.createElement('div');
    row.className = `log-row ${cycle.status}`;

    const summary = document.createElement('div');
    summary.className = 'log-summary';
    summary.innerHTML = `<strong>${formatTime(cycle.at)}</strong><span>${cycle.status.toUpperCase()}${cycle.cycleAvg ? ` - ${cycle.cycleAvg} ms` : ''}</span>`;

    const details = document.createElement('div');
    details.className = 'log-details';
    details.textContent = cycle.results
      .map((result) => `${result.ok ? 'OK' : 'FAIL'} ${result.name} ${result.rtt}ms`)
      .join('  |  ');

    row.append(summary, details);
    logList.appendChild(row);
  });
}

function getHealth(status) {
  if (status === 'ok') return { label: 'Good', className: 'good' };
  if (status === 'degraded') return { label: 'Degraded', className: 'warn' };
  if (status === 'down') return { label: 'Stalled', className: 'bad' };
  return { label: 'Idle', className: 'idle' };
}

function getYoutubeLabel(youtube) {
  if (!youtube || !youtube.active) return 'Inactive';
  if (youtube.buffering) return 'Buffering';
  if (youtube.playing) return 'Playing';
  return 'Open';
}

function formatLoss(stats) {
  if (!stats.probes) return '--';
  return `${Math.round((stats.failed / stats.probes) * 100)}%`;
}

function formatTime(iso) {
  if (!iso) return '--:--:--';
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
}

function send(message) {
  return chrome.runtime.sendMessage(message);
}
