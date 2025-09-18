// Popup focuses on user-facing settings; heavier diagnostics live in debug.html
const enabledEl = document.getElementById('enabled');
const keywordsEl = document.getElementById('keywords');
const saveBtn = document.getElementById('save');
const resetBtn = document.getElementById('reset');
const statusEl = document.getElementById('status');
const openDebugBtn = document.getElementById('openDebug');
const lightActivityEl = document.getElementById('lightActivity');
const lightDirectHideEl = document.getElementById('lightDirectHide');

// Built-in regex defaults are in code (same as content.js)
const BUILTIN_REGEX_DEFAULTS = [
  "re:/comment\\s+(\\w+|\\S+)\\s+and\\s+i(?:'|’)?ll\\s+share/i",
  "re:/comment\\s+(\\w+|\\S+)\\s+and\\s+i\\s+will\\s+share/i",
  "re:/drop\\s+(your\\s+)?email.*i(?:'|’)?ll\\s+(send|share)/i",
  "re:/comment\\s+“?interested”?/i",
  "re:/comment\\s+to\\s+receive/i",
  "re:/comment\\s+and\\s+i(?:'|’)?ll\\s+dm/i"
];

async function loadPackagedPhrases() {
  try {
    const url = chrome.runtime.getURL('keywords.json');
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('failed');
    const json = await res.json();
    return Array.isArray(json?.phrases) ? json.phrases : [];
  } catch {
    return [];
  }
}

function renderKeywords(list) {
  const lines = Array.isArray(list) ? list : [];
  keywordsEl.value = lines.join('\n');
}

// Initialize controls from storage so the popup reflects current state
(async function initPopup() {
  const packaged = await loadPackagedPhrases();
  chrome.storage.local.get({ enabled: true, keywords: packaged }, ({ enabled, keywords }) => {
    enabledEl.checked = !!enabled;
    renderKeywords(keywords);
  });

  // Green lights provide a quick DOM sanity check per session
  chrome.storage.local.get({ sessionSawActivityRoot: false, sessionSawDirectHideButton: false }, ({ sessionSawActivityRoot, sessionSawDirectHideButton }) => {
    if (lightActivityEl) lightActivityEl.style.background = sessionSawActivityRoot ? '#21c55d' : '#bbb';
    if (lightDirectHideEl) lightDirectHideEl.style.background = sessionSawDirectHideButton ? '#21c55d' : '#bbb';
  });
})();

// Live updates
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' && area !== 'session') return;
  if (changes.sessionSawActivityRoot && lightActivityEl) lightActivityEl.style.background = changes.sessionSawActivityRoot.newValue ? '#21c55d' : '#bbb';
  if (changes.sessionSawDirectHideButton && lightDirectHideEl) lightDirectHideEl.style.background = changes.sessionSawDirectHideButton.newValue ? '#21c55d' : '#bbb';
});

enabledEl.addEventListener('change', () => { chrome.storage.local.set({ enabled: enabledEl.checked }); });

// Persist user phrases; keep UI feedback minimal and non-blocking
saveBtn?.addEventListener('click', () => {
  const lines = keywordsEl.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  chrome.storage.local.set({ keywords: lines }, () => { statusEl.textContent = 'Saved'; setTimeout(() => (statusEl.textContent = ''), 1200); });
});

resetBtn?.addEventListener('click', async () => {
  const packaged = await loadPackagedPhrases();
  const defaults = [...packaged, ...BUILTIN_REGEX_DEFAULTS];
  renderKeywords(defaults);
  chrome.storage.local.set({ keywords: defaults }, () => { statusEl.textContent = 'Reset'; setTimeout(() => (statusEl.textContent = ''), 1200); });
});

openDebugBtn?.addEventListener('click', () => { window.location.href = 'debug.html'; });


