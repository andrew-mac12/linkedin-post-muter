// WHY: Debug panel mirrors internal state; keep responsibilities limited to display and toggles
const detectedLogEl = document.getElementById('detectedLog');
const hiddenLogEl = document.getElementById('hiddenLog');
const rootsSeenEl = document.getElementById('rootsSeen');
const debugLogEl = document.getElementById('debugLog');
const clearDetectedBtn = document.getElementById('clearDetected');
const clearHiddenBtn = document.getElementById('clearHidden');
const clearRootsBtn = document.getElementById('clearRoots');
const clearDebugBtn = document.getElementById('clearDebug');
const clearAllBtn = document.getElementById('clearAll');
const backBtn = document.getElementById('back');
const sessionCountEl = document.getElementById('sessionCount');
const debugEnabledEl = document.getElementById('debugEnabled');
const dryRunEl = document.getElementById('dryRun');
const maxHidesPerLoadEl = document.getElementById('maxHidesPerLoad');

function renderList(ul, list, format) {
  if (!ul) return;
  ul.innerHTML = '';
  const items = Array.isArray(list) ? list : [];
  items.forEach(entry => {
    const li = document.createElement('li');
    li.textContent = format(entry);
    ul.appendChild(li);
  });
}

function renderDetectedLog(list) {
  renderList(detectedLogEl, list, (entry) => `${new Date(entry.at||Date.now()).toLocaleTimeString()} — ${entry.snippet||''}`);
}

function renderHiddenLog(list) {
  renderList(hiddenLogEl, list, (entry) => `${new Date(entry.at||Date.now()).toLocaleTimeString()} — ${entry.urn||'(no urn)'} (${entry.reason||'hidden'})`);
}

function renderRootsSeen(list) {
  renderList(rootsSeenEl, list, (entry) => `${new Date(entry.at||Date.now()).toLocaleTimeString()} — ${entry.urn||'(no urn)'}`);
}

function renderDebugLog(list) {
  renderList(debugLogEl, list, (entry) => `${new Date(entry.at||Date.now()).toLocaleTimeString()} — ${entry.msg||''}`);
}

// WHY: Fetch all state together so paint is consistent; fewer storage roundtrips
function refreshAll() {
  chrome.storage.local.get({ detectedLog: [], hiddenLog: [], rootsSeen: [], debugLog: [], debugEnabled: false, dryRun: false, maxHidesPerLoad: null }, ({ detectedLog, hiddenLog, rootsSeen, debugLog, debugEnabled, dryRun, maxHidesPerLoad }) => {
    renderDetectedLog(detectedLog);
    renderHiddenLog(hiddenLog);
    renderRootsSeen(rootsSeen);
    renderDebugLog(debugLog);
    sessionCountEl.textContent = String(Array.isArray(hiddenLog) ? hiddenLog.length : 0);
    if (debugEnabledEl) debugEnabledEl.checked = !!debugEnabled;
    if (dryRunEl) dryRunEl.checked = !!dryRun;
    if (maxHidesPerLoadEl) maxHidesPerLoadEl.value = (maxHidesPerLoad == null ? '' : String(maxHidesPerLoad));
  });
}

refreshAll();

// WHY: Push updates live so the debug view feels like a live console
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' && area !== 'session') return;
  if (changes.detectedLog) renderDetectedLog(changes.detectedLog.newValue || []);
  if (changes.hiddenLog) { const list = changes.hiddenLog.newValue || []; renderHiddenLog(list); sessionCountEl.textContent = String(Array.isArray(list)?list.length:0); }
  if (changes.rootsSeen) renderRootsSeen(changes.rootsSeen.newValue || []);
  if (changes.debugLog) renderDebugLog(changes.debugLog.newValue || []);
  if (changes.debugEnabled && debugEnabledEl) debugEnabledEl.checked = !!changes.debugEnabled.newValue;
  if (changes.dryRun && dryRunEl) dryRunEl.checked = !!changes.dryRun.newValue;
  if (changes.maxHidesPerLoad && maxHidesPerLoadEl) maxHidesPerLoadEl.value = (changes.maxHidesPerLoad.newValue == null ? '' : String(changes.maxHidesPerLoad.newValue));
});

clearDetectedBtn.addEventListener('click', () => { chrome.storage.local.set({ detectedLog: [], sessionDetectedCount: 0 }, refreshAll); });
clearHiddenBtn.addEventListener('click', () => { chrome.storage.local.set({ hiddenLog: [] }, refreshAll); });
clearRootsBtn.addEventListener('click', () => { chrome.storage.local.set({ rootsSeen: [] }, refreshAll); });
clearDebugBtn.addEventListener('click', () => { chrome.storage.local.set({ debugLog: [] }, refreshAll); });
clearAllBtn.addEventListener('click', () => { chrome.storage.local.set({ detectedLog: [], hiddenLog: [], rootsSeen: [], debugLog: [], sessionDetectedCount: 0 }, refreshAll); });
backBtn.addEventListener('click', () => { window.location.href = 'popup.html'; });

// WHY: These toggles control verbosity and action level in the content script
debugEnabledEl?.addEventListener('change', () => {
  try { chrome.storage.local.set({ debugEnabled: !!debugEnabledEl.checked }); } catch {}
});

dryRunEl?.addEventListener('change', () => {
  try { chrome.storage.local.set({ dryRun: !!dryRunEl.checked }); } catch {}
});

maxHidesPerLoadEl?.addEventListener('input', () => {
  const raw = maxHidesPerLoadEl.value.trim();
  if (raw === '') { chrome.storage.local.set({ maxHidesPerLoad: null }); return; }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) { chrome.storage.local.set({ maxHidesPerLoad: Math.floor(n) }); }
});


