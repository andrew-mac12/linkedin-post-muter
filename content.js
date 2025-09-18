// Small random delays to look human
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Built-in regex patterns stay in code
const BUILTIN_REGEX = [
  /comment\s+(\w+|\S+)\s+and\s+i(?:'|’)?ll\s+share/i,
  /comment\s+(\w+|\S+)\s+and\s+i\s+will\s+share/i,
  /drop\s+(your\s+)?email.*i(?:'|’)?ll\s+(send|share)/i,
  /comment\s+“?interested”?/i,
  /comment\s+to\s+receive/i,
  /comment\s+and\s+i(?:'|’)?ll\s+dm/i
];

// Centralized selectors for LinkedIn DOM targets
const SELECTORS = {
  POST_ROOT: 'div.feed-shared-update-v2[role="article"], [role="article"], [data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"]',
  HIDE_BUTTON: 'button.feed-shared-control-menu__hide-post-button',
  OVERFLOW_TRIGGER: '.feed-shared-control-menu__trigger, button[aria-expanded][aria-haspopup="menu"], button[aria-label*="More"], button[aria-label*="options"]',
  MENU_ITEM: '[role="menuitem"], .artdeco-dropdown__item',
  TEXT_LTR: '.update-components-text [dir="ltr"]',
  TEXT_FALLBACK: '.update-components-text',
  HIDDEN_ALERT: 'div[role="alert"], [role="status"]',
  DATA_URN: '[data-urn]',
  DATA_ID_ACTIVITY: '[data-id^="urn:li:activity:"]'
};

// Menu text candidates to identify the hide action
const MENU_HIDE_TEXTS = ['hide this post','i don’t want to see this',"i don't want to see this",'not interested','this post is not relevant'];

// Toggle
let isEnabled = true;
let compiledRegexes = [];
let phraseListLC = [];
let hasHiddenThisLoad = false;
let hiddenThisLoadCount = 0;
let dryRun = true;
let keywordsReady = false;
let feedActive = false;
let debugEnabled = false;
let maxHidesPerLoad = null;

// Gate debug writes; excessive storage.set calls can degrade perf and spam logs
function logDebug(message) {
  if (!debugEnabled) return;
  try {
    const entry = { at: Date.now(), msg: String(message || '') };
    chrome.storage.local.get({ debugLog: [] }, ({ debugLog }) => {
      const next = Array.isArray(debugLog) ? debugLog : [];
      next.unshift(entry);
      if (next.length > 100) next.length = 100;
      chrome.storage.local.set({ debugLog: next });
    });
  } catch {}
}

// URL change poller to catch SPA navigations that don't fire history events
let __lastHref = location.href;
setInterval(() => {
  if (location.href !== __lastHref) {
    __lastHref = location.href;
    try { window.dispatchEvent(new Event('locationchange')); } catch {}
  }
}, 400);

function isOnFeed() { const p = location.pathname; return p === '/feed' || p.startsWith('/feed/'); }

// Central route toggle; keeps observers active only when needed and logs with context
function applyRouteState(reason = 'manual') {
  const onFeed = isOnFeed();
  logDebug(`[route] ${reason} → onFeed=${onFeed} href=${location.href}`);
  if (onFeed) {
    if (!feedActive) {
      feedActive = true;
      hasHiddenThisLoad = false;
      scanAll();
      try { observer.observe(document.body, { childList: true, subtree: true }); } catch {}
      logDebug('[feed] activated');
    }
  } else {
    if (feedActive) {
      safeDisconnectObservers();
      feedActive = false;
      logDebug('[feed] deactivated');
    }
  }
}
(function patchHistory(){
  try {
    const ps = history.pushState; const rs = history.replaceState;
    history.pushState = function(){ const r = ps.apply(this, arguments); window.dispatchEvent(new Event('locationchange')); return r; };
    history.replaceState = function(){ const r = rs.apply(this, arguments); window.dispatchEvent(new Event('locationchange')); return r; };
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
  } catch {}
})();
window.addEventListener('locationchange', () => applyRouteState('locationchange'));

async function loadPackagedPhrases() {
  try {
    const url = chrome.runtime.getURL('keywords.json');
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load keywords.json');
    const json = await res.json();
    const phrases = Array.isArray(json?.phrases) ? json.phrases : [];
    return phrases.map(s => String(s || '')).filter(Boolean);
  } catch {
    return [];
  }
}

function escapeRegexLiteral(input) { return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function compilePlaceholderPattern(line) {
  const parts = line.split('{any}');
  const body = parts.map(escapeRegexLiteral).join('[\\s\\S]+?');
  return new RegExp(body, 'i');
}

function setCompiledKeywordsFromSources(userLines, packagedPhrases) {
  compiledRegexes = [...BUILTIN_REGEX];
  phraseListLC = [];
  const addPatternOrPhrase = (p) => {
    const trimmed = String(p || '').trim();
    if (!trimmed) return;
    if (trimmed.includes('{any}')) { try { compiledRegexes.push(compilePlaceholderPattern(trimmed)); } catch {} }
    else { phraseListLC.push(trimmed.toLowerCase()); }
  };
  (Array.isArray(packagedPhrases) ? packagedPhrases : []).forEach(addPatternOrPhrase);
  (Array.isArray(userLines) ? userLines : []).forEach(line => {
    const t = String(line || '').trim(); if (!t) return;
    if (t.startsWith('re:/')) {
      const body = t.slice(3); const lastSlash = body.lastIndexOf('/');
      if (body[0] === '/' && lastSlash > 0) {
        const pattern = body.slice(1, lastSlash); const flags = body.slice(lastSlash + 1) || 'i';
        try { compiledRegexes.push(new RegExp(pattern, flags)); } catch {}
      }
    } else { addPatternOrPhrase(t); }
  });
  keywordsReady = true;
}

async function initializeKeywords() {
  const packaged = await loadPackagedPhrases();
  await new Promise((resolve) => {
    chrome.storage.local.get({ enabled: true, keywords: [], dryRun: false, debugEnabled: false, maxHidesPerLoad: null }, ({ enabled, keywords, dryRun: d, debugEnabled: de, maxHidesPerLoad: m }) => {
      isEnabled = enabled; dryRun = !!d; debugEnabled = !!de; maxHidesPerLoad = m;
      setCompiledKeywordsFromSources(keywords, packaged);
      resolve();
    });
  });
}

chrome.storage.onChanged.addListener(changes => {
  if (changes.enabled) isEnabled = !!changes.enabled.newValue;
  if (changes.keywords) { loadPackagedPhrases().then(packaged => { setCompiledKeywordsFromSources(changes.keywords.newValue, packaged); }); }
  if (changes.dryRun) dryRun = !!changes.dryRun.newValue;
  if (changes.debugEnabled) {
    const now = !!changes.debugEnabled.newValue;
    debugEnabled = now;
    if (now) {
      logDebug('[debug] enabled');
      if (isOnFeed()) { logDebug(`[feed] state: ${feedActive ? 'active' : 'inactive'}`); }
      try { applyRouteState('debug-toggle'); } catch {}
    } else {
      // Will not log due to gating, but keep for completeness
      logDebug('[debug] disabled');
    }
  }
  if (changes.maxHidesPerLoad) maxHidesPerLoad = changes.maxHidesPerLoad.newValue;
});

function shouldHide(text) {
  if (!text) return false;
  for (const re of compiledRegexes) { try { if (re.test(text)) return true; } catch {} }
  const lower = text.toLowerCase();
  return phraseListLC.some(p => lower.includes(p));
}

function findPostRoots() {
  return Array.from(document.querySelectorAll(SELECTORS.POST_ROOT));
}


function getPostText(postEl) {
  let textEl = postEl.querySelector(SELECTORS.TEXT_LTR);
  if (!textEl) textEl = postEl.querySelector(SELECTORS.TEXT_FALLBACK);
  if (!textEl) return '';
  const raw = (textEl.innerText || textEl.textContent || '').trim();
  const normalized = raw.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');
  return normalized;
}

function getPostUrn(postEl) {
  return (
    postEl.getAttribute('data-urn') || postEl.getAttribute('data-id') ||
    postEl.querySelector?.(SELECTORS.DATA_URN)?.getAttribute('data-urn') ||
    postEl.querySelector?.(SELECTORS.DATA_ID_ACTIVITY)?.getAttribute('data-id') ||
    postEl.closest?.(SELECTORS.DATA_URN)?.getAttribute('data-urn') ||
    postEl.closest?.(SELECTORS.DATA_ID_ACTIVITY)?.getAttribute('data-id') || null
  );
}

function recordDetection(postEl, text) {
  try {
    const entry = { urn: getPostUrn(postEl), at: Date.now(), snippet: String(text || '').slice(0, 200) };
    chrome.storage.local.get({ detectedLog: [], sessionDetectedCount: 0 }, ({ detectedLog, sessionDetectedCount }) => {
      const nextCount = (Number(sessionDetectedCount) || 0) + 1;
      if (debugEnabled) {
        const nextLog = Array.isArray(detectedLog) ? detectedLog : [];
        nextLog.unshift(entry);
        if (nextLog.length > 25) nextLog.length = 25;
        chrome.storage.local.set({ detectedLog: nextLog, sessionDetectedCount: nextCount });
      } else {
        chrome.storage.local.set({ sessionDetectedCount: nextCount });
      }
    });
  } catch {}
}

function recordHidden(postEl, reason) {
  try {
    const entry = { urn: getPostUrn(postEl), at: Date.now(), reason: reason || 'hidden' };
    if (!debugEnabled) return;
    chrome.storage.local.get({ hiddenLog: [] }, ({ hiddenLog }) => {
      const next = Array.isArray(hiddenLog) ? hiddenLog : [];
      next.unshift(entry);
      if (next.length > 25) next.length = 25;
      chrome.storage.local.set({ hiddenLog: next });
    });
  } catch {}
}

function isNowHiddenState(postEl) {
  try {
    const alert = postEl.querySelector(SELECTORS.HIDDEN_ALERT);
    if (alert && /post removed from your feed/i.test(alert.innerText || '')) return true;
    if (postEl.querySelector('.update-components-hidden-update-v2')) return true;
  } catch {}
  return false;
}

function recordRootSeen(postEl) {
  try {
    const urn = getPostUrn(postEl);
    // Always-on session indicators (bypass debugEnabled)
    try {
      const sawActivityRoot = !!(urn && urn.startsWith('urn:li:activity:'));
    const sawDirectHideBtn = !!postEl.querySelector(SELECTORS.HIDE_BUTTON);
      if (sawActivityRoot || sawDirectHideBtn) {
        chrome.storage.local.get({ sessionSawActivityRoot: false, sessionSawDirectHideButton: false }, ({ sessionSawActivityRoot, sessionSawDirectHideButton }) => {
          const updates = {};
          if (sawActivityRoot && !sessionSawActivityRoot) updates.sessionSawActivityRoot = true;
          if (sawDirectHideBtn && !sessionSawDirectHideButton) updates.sessionSawDirectHideButton = true;
          if (Object.keys(updates).length) { try { chrome.storage.local.set(updates); } catch {} }
        });
      }
    } catch {}

    if (!debugEnabled) return;
    const entry = { urn, at: Date.now() };
    chrome.storage.local.get({ rootsSeen: [] }, ({ rootsSeen }) => {
      const next = Array.isArray(rootsSeen) ? rootsSeen : [];
      if (entry.urn && next.some(e => e.urn === entry.urn)) return;
      next.unshift(entry); if (next.length > 50) next.length = 50;
      chrome.storage.local.set({ rootsSeen: next });
    });
  } catch {}
}

// Avoid brittle menus; if the post lacks a direct Hide button we skip it
function isSponsoredPost(postEl) {
  try {
    // Skip only if there is no direct hide button available in the post card
    const hasDirectHide = !!postEl.querySelector(SELECTORS.HIDE_BUTTON);
    return !hasDirectHide;
  } catch {
    return true;
  }
}

async function openOverflowMenu(postEl) {
  const btn = postEl.querySelector(SELECTORS.OVERFLOW_TRIGGER);
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await sleep(jitter(200, 500));
  btn.click(); btn.blur?.();
  await sleep(jitter(400, 900));
  return true;
}

function findMenuItemByText(substrings = []) {
  const items = Array.from(document.querySelectorAll(SELECTORS.MENU_ITEM));
  return items.find(item => { const t = item.textContent?.toLowerCase() || ''; return substrings.some(s => t.includes(s)); });
}

async function clickHideInMenu() {
  const item = findMenuItemByText(MENU_HIDE_TEXTS); if (!item) return false;
  item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await sleep(jitter(150, 400));
  item.click(); item.blur?.();
  await sleep(jitter(500, 1000));
  return true;
}

async function clickDirectHide(postEl) {
  const btn = postEl.querySelector(SELECTORS.HIDE_BUTTON); if (!btn) return false;
  btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await sleep(jitter(150, 350));
  btn.click(); btn.blur?.();
  await sleep(jitter(400, 900));
  return true;
}

async function waitForRemoval(postEl, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!postEl.isConnected) return true;
    const rect = postEl.getBoundingClientRect?.();
    if (rect && (rect.width === 0 || rect.height === 0)) return true;
    if (isNowHiddenState(postEl)) return true;
    await sleep(100);
  }
  return false;
}

const processed = new WeakSet();

// Keep the decision tree flat with early returns to stay cheap and readable
async function maybeHide(postEl) {
  if (!isOnFeed()) return;
  if (processed.has(postEl)) return;
  if (!isEnabled) return;
  if (!keywordsReady) { try { inViewObserver.observe(postEl); } catch {} return; }
  if (document.visibilityState !== 'visible') return;
  if (isSponsoredPost(postEl)) { processed.add(postEl); return; }
  const txt = getPostText(postEl);
  if (!shouldHide(txt)) { processed.add(postEl); return; }
  recordDetection(postEl, txt);
  if (dryRun) { processed.add(postEl); return; }
  if (typeof maxHidesPerLoad === 'number' && Number.isFinite(maxHidesPerLoad)) {
    if (hiddenThisLoadCount >= maxHidesPerLoad) { processed.add(postEl); return; }
  } else {
    // Back-compat: previous behavior was 1 per load
    if (hasHiddenThisLoad) { processed.add(postEl); return; }
  }
  try {
    await sleep(jitter(350, 1200));
    const direct = await clickDirectHide(postEl);
    if (direct) { const ok = await waitForRemoval(postEl); if (ok) { hiddenThisLoadCount++; hasHiddenThisLoad = true; incrementSessionHiddenCount(); if (typeof maxHidesPerLoad !== 'number') safeDisconnectObservers(); processed.add(postEl); return; } }
    const opened = await openOverflowMenu(postEl); if (!opened) { processed.add(postEl); return; }
    await sleep(jitter(250, 700));
    const clicked = await clickHideInMenu();
    if (clicked) { const ok = await waitForRemoval(postEl); if (ok) { hiddenThisLoadCount++; hasHiddenThisLoad = true; incrementSessionHiddenCount(); if (typeof maxHidesPerLoad !== 'number') safeDisconnectObservers(); processed.add(postEl); return; } }
  } catch (e) { } finally { processed.add(postEl); }
}

function scanAll() { if (!isOnFeed()) return; hiddenThisLoadCount = 0; hasHiddenThisLoad = false; logDebug('scanAll onFeed=true'); findPostRoots().forEach(el => registerForViewport(el)); }

const observer = new MutationObserver((muts) => {
  if (!isOnFeed()) return;
  for (const m of muts) {
    for (const node of m.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (hasHiddenThisLoad && !dryRun) return;
      if (node.matches?.(SELECTORS.POST_ROOT)) { registerForViewport(node); }
      else { node.querySelectorAll?.(SELECTORS.POST_ROOT).forEach(el => { registerForViewport(el); }); }
    }
  }
});

//  Defer work until posts are actually visible to minimize DOM churn
const inViewObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target;
    if (!isOnFeed()) { inViewObserver.unobserve(el); continue; }
    recordRootSeen(el);
    inViewObserver.unobserve(el);
    maybeHide(el);
  }
}, { root: null, rootMargin: '0px', threshold: 0.01 });

function registerForViewport(postEl) { if (!isOnFeed()) return; try { inViewObserver.observe(postEl); } catch {} }

// Initialize without requiring a refresh
const start = async () => { await initializeKeywords(); applyRouteState('init'); };
if (document.readyState === 'complete' || document.readyState === 'interactive') start();
else window.addEventListener('load', start);

function safeDisconnectObservers() { try { inViewObserver.disconnect(); } catch {} try { observer.disconnect(); } catch {} }

function incrementSessionHiddenCount() { try { chrome.storage.local.get({ sessionHiddenCount: 0 }, ({ sessionHiddenCount }) => { const next = (Number(sessionHiddenCount) || 0) + 1; chrome.storage.local.set({ sessionHiddenCount: next, lastHiddenAt: Date.now() }); }); } catch {} }



