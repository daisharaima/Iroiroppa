'use strict';

/* Settings window. Segmented tabs (General / Appearance); General holds the
 * connection + behaviour rows, Appearance the crosshair toggle, UI scale and
 * theme. Talks to main through window.csp only. */

const $ = (id) => document.getElementById(id);

// User modules (docs/USER-MODULES.md), so the Modules list can offer them.
try { window.IroModuleManifest.register(window.csp.userModules()); } catch { /* bundled only */ }

const el = {
  dot: $('settings-dot'),
  state: $('settings-state'),
  version: $('settings-version'),
  update: $('settings-update'),
  check: $('settings-check'),
  btnConn: $('btn-conn'),
  btnForget: $('btn-forget'),
  btnReconnect: $('btn-reconnect'),
  pairRow: $('conn-pair'),
  qrUrl: $('qr-url'),
  setLive: $('set-live'),
  setAutoHide: $('set-autohide'),
  setCross: $('set-cross'),
  setLogin: $('set-login'),
  setSummon: $('set-summon'),
  commandList: $('set-command-list'),
  setUiScale: $('set-ui-scale'),
  uiScaleValue: $('ui-scale-value'),
  btnScaleUp: $('btn-scale-up'),
  btnScaleDown: $('btn-scale-down'),
  btnScaleReset: $('btn-scale-reset'),
  setTheme: $('set-theme'),
  setLanguage: $('set-language'),
  setNames: $('set-names'),
  setAutoConnect: $('set-autoconnect'),
  setProfileDefault: $('set-profile-default'),
  setProfileBrowse: $('set-profile-browse'),
  setProfileList: $('set-profile-list'),
  moduleList: $('module-list'),
  btnTrash: $('btn-trash'),
  btnPurge: $('btn-purge'),
  trashPanel: $('trash-panel'),
  trashList: $('trash-list'),
  trashCount: $('trash-count'),  moduleDetail: $('module-detail'),
  btnAccent: $('btn-accent'),
  btnAccentReset: $('btn-accent-reset'),
  accentBackdrop: $('accent-backdrop'),
  accentPopup: $('accent-popup'),
  accentSv: $('accent-sv'),
  accentThumb: $('accent-thumb'),
  accentHue: $('accent-hue'),
  accentPreview: $('accent-preview'),
  accentHex: $('accent-hex'),
  accentCancel: $('accent-cancel'),
  accentSave: $('accent-save'),
};

const hex6 = (v) => {
  const s = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return '';
};

const themeRegistry = new window.Iro.ThemeRegistry();
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
let themeId = 'default-light';
let accents = {}; // persisted per-theme overrides

const SCALE_MIN = 0.8;
const SCALE_MAX = 1.6;
let scaleFrame = null; // one uiScale update per frame

/** The current UI scale from the slider. */
function currentScale() {
  const s = Number(el.setUiScale.value);
  return Number.isFinite(s) ? clamp(s, SCALE_MIN, SCALE_MAX) : 1;
}

/** Set the UI scale (clamped to whole percent), reflect it and persist it. */
function setScale(scale) {
  const s = Math.round(clamp(scale, SCALE_MIN, SCALE_MAX) * 100) / 100;
  el.setUiScale.value = String(s);
  el.uiScaleValue.value = String(Math.round(s * 100));
  csp.updateSettings({ uiScale: s });
}

/** Fill the theme dropdown from the registry. */
function populateThemes() {
  el.setTheme.replaceChildren();
  for (const t of themeRegistry.themes) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    el.setTheme.append(opt);
  }
}

/** Fill the language dropdown from the shipped locales. */
async function populateLanguages() {
  let codes = ['en'];
  try { codes = await window.csp.i18nLocales(); } catch { /* bundled English only */ }
  const names = window.IroLocaleNames;
  const label = (code) => (names ? names.nameOf(code) : code);
  // Each language is written in its own language and sorted by that name, the
  // way Photoshop presents its UI languages.
  codes = [...new Set((codes || []).map((c) => String(c).toLowerCase()))]
    .sort((a, b) => label(a).localeCompare(label(b)));
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = window.Iro.t('settings.language.auto');
  el.setLanguage.replaceChildren(auto);
  for (const code of codes) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label(code);
    el.setLanguage.append(opt);
  }
}

/** The theme's own accent, ignoring any override. */
function themeOwnAccent() {
  const theme = themeRegistry.resolve(themeId);
  return hex6(theme && theme.tokens && theme.tokens['--accent']) || '#6c5ce7';
}

/** The accent currently saved for this theme. */
function effectiveAccent() {
  return hex6(accents[themeId]) || themeOwnAccent();
}

/** Persist the accent map, apply it here and tell the main process. */
function commitAccents(next) {
  accents = next;
  themeRegistry.apply(themeId, next[themeId] || '');
  updateAccentTrigger();
  csp.updateSettings({ accents: next });
}

/** Reflect the saved accent on the trigger swatch; Reset is live when overridden. */
function updateAccentTrigger() {
  el.btnAccent.style.background = effectiveAccent();
  el.btnAccentReset.disabled = !hex6(accents[themeId]);
}

// --- accent picker popup ---------------------------------------------------

let accentHsv = { h: 0, s: 0, v: 1 };
let svDragging = false;

function accentHsvHex() {
  const f = Color.hsvToRgb(accentHsv.h, accentHsv.s, accentHsv.v);
  return Color.rgbToHex(f.r * 255, f.g * 255, f.b * 255);
}

function renderAccentPopup() {
  const hex = accentHsvHex();
  el.accentSv.style.background = `hsl(${accentHsv.h} 100% 50%)`;
  el.accentThumb.style.left = `${accentHsv.s * 100}%`;
  el.accentThumb.style.top = `${(1 - accentHsv.v) * 100}%`;
  el.accentHue.value = String(Math.round(accentHsv.h));
  el.accentPreview.style.background = hex;
  if (document.activeElement !== el.accentHex) el.accentHex.value = hex;
}

function openAccentPopup() {
  const rgb = Color.hexToRgb(effectiveAccent()) || { r: 108, g: 92, b: 231 };
  accentHsv = Color.rgbToHsv(rgb.r / 255, rgb.g / 255, rgb.b / 255);
  el.accentBackdrop.classList.remove('hidden');
  el.accentPopup.classList.remove('hidden');
  renderAccentPopup();
}

function closeAccentPopup() {
  el.accentBackdrop.classList.add('hidden');
  el.accentPopup.classList.add('hidden');
}

function accentPopupOpen() {
  return !el.accentPopup.classList.contains('hidden');
}

// --- update notice ---------------------------------------------------------

let updateUrl = '';

/** Show "Update available" only when the main-process check found one. */
function showUpdate(info) {
  const on = Boolean(info && info.available && info.url);
  updateUrl = on ? info.url : '';
  el.update.classList.toggle('hidden', !on);
  if (on) el.update.textContent = window.Iro.t('settings.update.available', { version: info.version });
}

/** Manual re-check; it reports "Up to date" briefly, or shows the release link. */
async function checkUpdates() {
  el.check.disabled = true;
  const label = el.check.textContent;
  el.check.textContent = window.Iro.t('settings.conn.checking');
  const upToDate = window.Iro.t('settings.conn.upToDate');
  try {
    const info = await csp.checkForUpdates();
    showUpdate(info);
    if (info && info.available) {
      el.check.textContent = label;
    } else {
      el.check.textContent = upToDate;
      setTimeout(() => { if (el.check.textContent === upToDate) el.check.textContent = label; }, 3000);
    }
  } catch {
    el.check.textContent = label;
  } finally {
    el.check.disabled = false;
  }
}

function applySettings(s) {
  liveSettings = s;
  el.setLive.checked = s.liveSync !== false;
  el.setAutoHide.checked = s.autoHide !== false;
  el.setAutoConnect.checked = s.autoConnect !== false;
  el.setNames.checked = s.hideModuleNames === true;
  currentProfileValue = s.proofMode === 'default' ? '' : (s.proofProfile || '');
  renderProfiles();
  el.setCross.checked = s.crosshair !== false;
  el.setLogin.checked = s.launchAtLogin === true;
  el.setSummon.value = s.summonHotkey || '';
  renderCommandList();
  const scale = Number(s.uiScale) || 1;
  el.setUiScale.value = String(scale);
  if (document.activeElement !== el.uiScaleValue) el.uiScaleValue.value = String(Math.round(scale * 100));

  accents = { ...(s.accents || {}) };
  themeId = themeRegistry.themes.some((t) => t.id === s.theme) ? s.theme : 'default-light';
  el.setTheme.value = themeId;
  if (el.setLanguage) el.setLanguage.value = s.language || '';
  // The whole Settings window follows the same locale as the palette. Re-applying it
  // rewrites every [data-i18n] node, including the connection row that updateStatus
  // owns — so only switch when the language actually changed, then repaint the status.
  const language = s.language || navigator.language || 'en';
  if (language !== appliedLanguage) {
    appliedLanguage = language;
    window.Iro.i18n.use(language).then(() => { if (lastStatus) updateStatus(lastStatus); });
  }
  themeRegistry.apply(themeId, accents[themeId]);
  updateAccentTrigger();
  requestAnimationFrame(fitWindow);
}

let connState = 'idle';
let lastStatus = null;
let appliedLanguage = null;

function updateStatus(status) {
  connState = status.state;
  lastStatus = status;
  const connected = status.state === 'connected';
  const scanning = status.state === 'scanning';
  el.dot.className = 'dot';
  if (connected) el.dot.classList.add('online');
  else if (status.state === 'error') el.dot.classList.add('error');
  else if (status.state !== 'idle') el.dot.classList.add('busy');

  const labels = {
    connected: window.Iro.t('settings.status.connected'),
    scanning: window.Iro.t('settings.status.scanning'),
    connecting: window.Iro.t('settings.status.connecting'),
    authenticating: window.Iro.t('settings.status.authenticating'),
    reconnecting: window.Iro.t('settings.status.reconnecting'),
    error: window.Iro.t('settings.status.error'),
    idle: window.Iro.t('settings.status.idle'),
  };
  el.state.textContent = labels[status.state] || status.state;
  el.state.title = status.detail || '';
  el.btnConn.textContent = connected
    ? window.Iro.t('settings.conn.disconnect')
    : scanning
      ? window.Iro.t('settings.conn.cancel')
      : window.Iro.t('settings.conn.connect');
  el.btnConn.classList.toggle('primary', !connected);
  el.btnForget.classList.toggle('hidden', !connected);
  el.pairRow.classList.toggle('hidden', connected);
}

/** Ask main to size the window exactly to its content, so no scrollbar shows. */
function fitWindow() {
  const body = document.getElementById('settings-body');
  const bar = document.getElementById('titlebar');
  if (!body) return;
  const needed = Math.ceil((bar ? bar.offsetHeight : 0) + body.offsetHeight);
  // The viewport shrinks when the UI scale zooms in, so re-fit whenever the
  // measured content and the viewport disagree (main takes CSS pixels).
  if (Math.abs(needed - window.innerHeight) > 2) csp.resizeSettings(needed);
}

/** The tab currently shown, so a layout change can refresh the right pane. */
let activeTab = 'appearance';

const TABS = new Set(['general', 'appearance', 'modules', 'layout']);

function selectTab(name) {
  if (!TABS.has(name)) name = 'appearance';
  activeTab = name;
  for (const btn of document.querySelectorAll('.seg-btn[data-tab]')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  $('tab-general').classList.toggle('hidden', name !== 'general');
  $('tab-appearance').classList.toggle('hidden', name !== 'appearance');
  $('tab-modules').classList.toggle('hidden', name !== 'modules');
  $('tab-layout').classList.toggle('hidden', name !== 'layout');
  if (name === 'modules') refreshModules();
  else destroyPreview();
  if (name === 'layout') renderLayoutTab();
  if (name === 'general') loadProfiles(true);
  requestAnimationFrame(fitWindow);
}

/** Re-read the board layout (it may have changed in the palette). */
async function refreshModules() {
  // The live v2 document, not the legacy stored `columns` + float list: they disagree
  // after a hide/show, and the live one is what the palette is actually showing.
  await loadBoardLayout();
  renderModules();
}

// --- colour profile (the palette's mode bar, mirrored here) -----------------

let profileOptions = [];
let currentProfileValue = '';

async function loadProfiles(refresh = false) {
  try { profileOptions = await window.csp.listProofProfiles(refresh); } catch { profileOptions = []; }
  renderProfiles();
}

function renderProfiles() {
  const proofing = Boolean(currentProfileValue);
  el.setProfileDefault.classList.toggle('selected', !proofing);
  el.setProfileList.replaceChildren();
  const rows = [];
  const seen = new Set();
  if (currentProfileValue) {
    rows.push({ path: currentProfileValue, name: currentProfileValue.split(/[\\/]/).pop() });
    seen.add(currentProfileValue);
  }
  for (const p of profileOptions) {
    if (seen.has(p.path)) continue;
    seen.add(p.path);
    rows.push(p);
  }
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'profile-empty';
    empty.textContent = window.Iro.t('settings.profile.none');
    el.setProfileList.append(empty);
    return;
  }
  for (const p of rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'profile-item';
    row.classList.toggle('selected', p.path === currentProfileValue);
    const dot = document.createElement('span');
    dot.className = 'profile-dot';
    const name = document.createElement('span');
    name.className = 'profile-item-name';
    name.textContent = p.name;
    row.append(dot, name);
    row.title = p.path;
    row.addEventListener('click', () => chooseProfile(p.path));
    el.setProfileList.append(row);
  }
}

async function chooseProfile(path) {
  currentProfileValue = path || '';
  renderProfiles();
  if (!path) await window.csp.updateSettings({ proofMode: 'default' });
  else await window.csp.updateSettings({ proofProfile: path, proofMode: 'proof' });
}

async function browseProfile() {
  try {
    const picked = await window.csp.browseProofProfile();
    const path = typeof picked === 'string' ? picked : (picked && picked.path);
    if (!path) return;
    await chooseProfile(path);
    await loadProfiles(true);
  } catch { /* dialog cancelled or unreadable profile */ }
}

// --- modules tab -----------------------------------------------------------

let moduleIds = [];
let boardLayout = null;
const moduleSettingsCache = new Map();
// Which instance the Modules tab is editing ('' = the module's own defaults, which
// every instance inherits from: docs/LAYOUT.md, N1).
let selectedInstance = '';

/**
 * The Settings window's minimum width. The module-name column only has to fit
 * the longest name; the detail pane keeps a usable minimum beside it, so the
 * window can never be narrowed onto a horizontal scrollbar in the settings
 * column.
 */
const MODULE_DETAIL_MIN = 200;
function applySettingsMinWidth() {
  if (!el.moduleList || !window.csp.setSettingsMinWidth) return;
  let widest = 0;
  const probe = document.createElement('span');
  probe.className = 'module-name';
  probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;white-space:nowrap;visibility:hidden;';
  document.body.append(probe);
  for (const id of moduleIds) {
    probe.textContent = moduleName(id);
    widest = Math.max(widest, probe.getBoundingClientRect().width);
  }
  probe.remove();
  // light (10) + row gap (8) + row padding (8×2) + list padding (4×2) + a
  // little slack for the scrollbar and borders.
  const listWidth = Math.ceil(widest) + 62;
  const needed = Math.min(560, Math.max(300, listWidth + MODULE_DETAIL_MIN + 26));
  Promise.resolve(window.csp.setSettingsMinWidth(needed)).catch(() => {});
}

/** A module changed elsewhere: drop the cached copy and refresh its detail. */
function invalidateModule(id) {
  // The cache is keyed by the instance being edited (or the module id for its
  // defaults), while the broadcast carries the module id — deleting by that id
  // almost always missed. Clear it; the detail is re-read on demand.
  moduleSettingsCache.clear();
  const onModules = !document.getElementById('tab-modules').classList.contains('hidden');
  if (id === selectedModule && onModules) renderModuleDetail();
}

/** Load the module list, each module's script (for its name/settings UI) and
 * the current board layout. */
/** Fetch the live board layout (the palette's columns and every float's). */
async function loadBoardLayout() {
  try {
    // `workspace:get` is the live document (never null); `getLayout` is the stored
    // one, which stays null on a first run.
    const layout = (await window.csp.getWorkspace()) || (await window.csp.getLayout());
    const floats = await window.csp.floatsList();
    let hiddenInstances = [];
    try { hiddenInstances = (await window.csp.listHidden()) || []; } catch { hiddenInstances = []; }
    boardLayout = {
      version: 1,
      columns: (layout && layout.columns) || [],
      floats: floats || [],
      hiddenInstances,
    };
  } catch { boardLayout = null; }
  return boardLayout;
}

async function loadModules() {
  try { moduleIds = await window.csp.listModuleIds(); } catch { moduleIds = []; }
  // The layout is fetched *before* the module scripts: the script loads are awaited
  // one by one, and the Modules tab can be opened while they are still arriving — a
  // detail pane rendered in that window would not know what is mounted (N1's strip).
  await loadBoardLayout();
  for (const id of moduleIds) {
    if (window.Iro.modules && window.Iro.modules[id]) continue;
    await new Promise((resolve) => {
      const script = document.createElement('script');
      const known = window.IroModuleManifest && window.IroModuleManifest.get(id);
      script.src = (known && known.user) ? `module://${id}/module.js` : `selector_module/${id}.js`;
      script.onload = resolve;
      script.onerror = resolve;
      document.head.append(script);
    });
  }
  // If the tab is already showing, the detail pane may have rendered before the
  // layout arrived: render it again now that the data is here.
  const onModulesTab = !document.getElementById('tab-modules').classList.contains('hidden');
  if (onModulesTab && selectedModule) renderModuleDetail();
}

/**
 * After an instance control (add / duplicate / hide / show / delete): reload the layout and
 * re-render. A newly created instance becomes the selection, so its settings are in front of
 * you; anything else clears it, because the instance that was selected may be gone.
 */
async function refreshAfterInstanceChange(out) {
  if (out && out.ok === false && out.error) {
    console.warn('[settings] instance control refused:', out.error);
  }
  moduleSettingsCache.clear();
  selectedInstance = (out && out.instanceId) || '';
  await loadBoardLayout();
  refreshModuleLights();
  renderModuleDetail();
}

/** Every mounted instance of a module, and where it lives. */
function instancesOf(moduleId) {
  const out = [];
  const visit = (columns, where) => {
    for (const col of columns || []) {
      for (const m of col.modules || []) {
        if (m.moduleId === moduleId && m.instanceId) out.push({ instanceId: m.instanceId, where });
      }
    }
  };
  if (boardLayout) {
    visit(boardLayout.columns, 'palette');
    for (const [i, f] of (boardLayout.floats || []).entries()) visit(f.columns, `float ${i + 1}`);
  }
  return out;
}

/**
 * Read/write settings from this window. `key` is the instance being edited, or the
 * module id for its defaults; `moduleId` is the fallback an instance inherits from
 * (docs/LAYOUT.md, N1).
 */
async function moduleSettingsApi(key, moduleId) {
  if (!moduleSettingsCache.has(key)) {
    const def = (window.Iro.modules && window.Iro.modules[moduleId]) || {};
    let stored = {};
    try { stored = (await window.csp.getModuleSettings(key, moduleId)) || {}; } catch { stored = {}; }
    if (typeof def.migrate === 'function') {
      try { stored = def.migrate(stored) || stored; } catch { /* keep as-is */ }
    }
    // Show the effective values, not just the stored ones (a module with no saved
    // file runs on its defaults).
    moduleSettingsCache.set(key, { ...(def.defaults || {}), ...stored });
  }
  const current = moduleSettingsCache.get(key);
  return {
    get: () => ({ ...current }),
    patch: (partial) => {
      Object.assign(current, partial || {});
      window.csp.saveModuleSettings(key, current, 1, moduleId).catch(() => {});
    },
  };
}

function moduleUsageOf(id) {
  const usage = window.IroModuleUsage;
  return usage
    ? usage.moduleUsage(id, boardLayout || {})
    : { visible: 0, hidden: 0, total: 0, enabled: false };
}

/** Repaint the left light from live board data, without rebuilding the list. */
function refreshModuleLights() {
  if (!el.moduleList) return;
  for (const row of el.moduleList.querySelectorAll('.module-row')) {
    const light = row.querySelector('.module-light');
    if (!light) continue;
    const usage = moduleUsageOf(row.dataset.module);
    light.classList.toggle('on', usage.visible > 0);
    let title;
    if (usage.visible > 0) title = window.Iro.t('settings.modules.mountedCount', { n: usage.visible });
    else if (usage.hidden > 0) title = window.Iro.t('settings.modules.hiddenCount', { n: usage.hidden });
    else title = window.Iro.t('settings.modules.notMounted');
    light.title = title;
    light.setAttribute('aria-label', title);
  }
}



const moduleName = (id) => {
  const manifest = (window.IroModuleManifest && window.IroModuleManifest.get(id)) || {};
  const fallback = manifest.name || id;
  return (window.Iro && window.Iro.i18n) ? window.Iro.i18n.moduleName(id, fallback) : fallback;
};

// --- module preview --------------------------------------------------------

// Renders the selected module into the detail pane so turning one off is not
// guesswork. It gets its own ColorStore and a no-op CSP, so a stray interaction
// cannot write to the real one (the preview is pointer-inert as well), and it
// mirrors the live mode, gamut and colour so it looks like the palette.
let previewStore = null;
let previewHost = null;
let previewRecord = null;
let previewColor = null;
let liveSettings = {};
let detailToken = 0;

function getPreviewStore() {
  if (!previewStore) {
    previewStore = new window.Iro.ColorStore({ csp: { pushHistory() {}, selectSlot() {} } });
  }
  return previewStore;
}

function destroyPreview() {
  if (previewRecord) {
    try { previewRecord.ro && previewRecord.ro.disconnect(); } catch { /* ignore */ }
    try {
      if (previewRecord.instance && previewRecord.instance.destroy) previewRecord.instance.destroy();
    } catch { /* ignore */ }
    previewRecord = null;
  }
  if (previewHost) previewHost.reset();
}

/** Mirror the live appearance: colour mode, proof gamut, crosshair and colour. */
async function syncPreview() {
  const store = getPreviewStore();
  const mode = liveSettings.proofMode === 'proof' ? 'proof' : 'default';
  store.mode = mode;
  store.crosshair = liveSettings.crosshair !== false;
  if (mode === 'proof') {
    try {
      const info = await window.csp.getProof();
      store.proofInfo = info;
      store.proof = info && info.ok ? window.Proof.createProof(info.profile, liveSettings.proofModel || 'working') : null;
    } catch { store.proof = null; }
  } else {
    store.proof = null;
  }
  if (previewColor) store.applyIncoming(previewColor);
  ensurePreviewState(store);
  store.notify();
}

// The preview is a mockup: it seeds representative slots and a few rows of
// colours so a module looks like it does in use (there is no live history in the
// Settings window). Nothing here touches the real store or CSP.
let previewHistorySeeded = false;
function ensurePreviewState(store) {
  if (!store.slots.main) {
    const main = { r: 0x8f, g: 0xd6, b: 0xcf };
    const sub = { r: 0xe9, g: 0xbf, b: 0xdb };
    store.applyIncoming({ main: { rgb: main }, sub: { rgb: sub }, active: 'main', rgb: main, transparent: false });
  }
  if (!previewHistorySeeded) {
    previewHistorySeeded = true;
    store.setHistory(previewHistory(48));
  }
}

/** A spread of pleasant colours, enough to fill three history rows. */
function previewHistory(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const h = ((i * 360) / count + 12) % 360;
    const rgb = window.Color.oklchToRgb(0.7 + (i % 3) * 0.09, 0.1 + (i % 4) * 0.03, h);
    out.push({ r: Math.round(rgb.r * 255), g: Math.round(rgb.g * 255), b: Math.round(rgb.b * 255) });
  }
  return out;
}

/**
 * The preview box height for a module. These are the sizes the modules are shown
 * at in the docs: a short CSP Color strip, a 90px slider, three history rows, and
 * tall enough for every Color Slices panel (so no slice looks omitted).
 */
const PREVIEW_HEIGHTS = { 'csp-color': 40, 'color-slider': 90, 'color-wheel': 170, 'color-disc': 210 };
function previewHeight(id, settings) {
  if (PREVIEW_HEIGHTS[id]) return PREVIEW_HEIGHTS[id];
  if (id === 'color-history') {
    const tile = Math.max(12, Math.min(48, Number(settings.tile) || 24));
    return 36 + tile * 3 + 2; // head + three rows + two 1px gaps
  }
    if (id === 'color-slices') {
    const panels = ['constantHue', 'constantLightness', 'constantChroma']
      .filter((k) => settings[k] !== false).length || 1;
    return 34 + panels * 60;
  }
  return 160;
}

/** Mount the module into a preview box; a no-op for a module with no view. */
async function renderModulePreview(id, settings, token) {
  const def = (window.Iro.modules && window.Iro.modules[id]) || {};
  if (typeof def.create !== 'function') return;
  const box = document.createElement('div');
  box.className = 'module-preview';
  box.style.height = `${previewHeight(id, settings)}px`;
  box.setAttribute('aria-hidden', 'true');
  el.moduleDetail.append(box);

  await syncPreview();
  if (token !== detailToken) return;
  if (!previewHost) {
    previewHost = new window.Iro.ModuleHost({
      root: document.createElement('div'),
      color: getPreviewStore(),
      csp: window.csp,
    });
  }
  const record = await previewHost.mount(id, box, `preview-${id}`, { settings });
  if (token !== detailToken) {
    try { record.ro && record.ro.disconnect(); } catch { /* ignore */ }
    try { record.instance && record.instance.destroy && record.instance.destroy(); } catch { /* ignore */ }
    box.remove();
    return;
  }
  previewRecord = record;
  // The module lays out on a real size, which only exists once it is in the DOM.
  requestAnimationFrame(() => {
    if (previewRecord === record && record.instance && record.instance.onResize) {
      record.instance.onResize({ width: box.clientWidth, height: box.clientHeight });
    }
  });
}

/** The Modules tab: a list of modules on the left (each with an on/off light),
 *  the selected module's settings on the right. */
let selectedModule = null;

// --- the Trash: settings files nothing uses ---------------------------------
// Both a module default and an instance in the workspace count as used; a file for an instance that
// was deleted, or for a module that no longer exists, does not. Deleting keeps those files so a
// mis-click is recoverable, and startup sweeps the ones older than module-store's TRASH_DAYS.
async function renderTrash() {
  if (!el.trashPanel || !el.trashList || !el.trashCount || !csp.listTrash) return;
  const info = await csp.listTrash();
  const files = (info && info.files) || [];
  el.trashCount.textContent = files.length
    ? `Trash — ${files.length} unused settings file${files.length === 1 ? '' : 's'}`
    : 'Trash — empty';
  el.trashList.replaceChildren(...files.map((f) => {
    const item = document.createElement('div');
    item.className = 'trash-item';

    const row = document.createElement('div');
    row.className = 'trash-row';
    const label = document.createElement('span');
    label.className = 'trash-label';
    label.textContent = `${f.id} · ${f.ageDays} day${f.ageDays === 1 ? '' : 's'} old`;

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'btn tiny';
    preview.textContent = window.Iro.t('settings.modules.preview');

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn tiny';
    restore.textContent = window.Iro.t('settings.modules.restore');
    restore.title = window.Iro.t('settings.modules.restoreTitle');

    const detail = document.createElement('pre');
    detail.className = 'trash-preview hidden';

    preview.addEventListener('click', async () => {
      if (!detail.classList.contains('hidden')) {
        detail.classList.add('hidden');
        requestAnimationFrame(fitWindow);
        return;
      }
      const out = await csp.trashPreview(f.id);
      if (out && out.ok) {
        detail.textContent = (out.moduleId
          ? `module: ${out.moduleId}\n`
          : 'module: unknown (this file predates the record and cannot be restored)\n')
          + JSON.stringify(out.settings, null, 2);
      } else {
        detail.textContent = window.Iro.t('settings.modules.unreadable');
      }
      detail.classList.remove('hidden');
      requestAnimationFrame(fitWindow);
    });

    restore.addEventListener('click', async () => {
      restore.disabled = true;
      const out = await csp.trashRestore(f.id);
      if (out && out.ok === false) {
        restore.disabled = false;
        restore.title = `Not restored: ${out.error || 'the app refused'}`;
        return;
      }
      moduleSettingsCache.clear();
      await loadBoardLayout();
      await renderTrash();
    });

    row.append(label, preview, restore);
    item.append(row, detail);
    return item;
  }));
  el.btnPurge.disabled = files.length === 0;
  requestAnimationFrame(fitWindow);
}


if (el.btnTrash) {
  el.btnTrash.addEventListener('click', async () => {
    const hidden = el.trashPanel.classList.toggle('hidden');
    if (!hidden) await renderTrash();
  });
  el.btnPurge.addEventListener('click', async () => {
    const out = await csp.purgeTrash();
    const removed = (out && out.removed) || 0;
    await renderTrash();
    const note = document.createElement('div');
    note.className = 'trash-row';
    note.textContent = `${removed} file${removed === 1 ? '' : 's'} removed`;
    el.trashList.prepend(note);
  });
}

const GROUP_ORDER = ['core', 'picker', 'utility'];
const GROUP_LABELS = { core: 'settings.group.core', picker: 'settings.group.picker', utility: 'settings.group.utility' };

/** The Modules-tab section a module belongs to (from the manifest). */
function moduleGroupOf(id) {
  const man = window.IroModuleManifest;
  const def = man && man.get ? man.get(id) : null;
  return (def && def.group) || 'utility';
}

function renderModules() {
  el.moduleList.replaceChildren();
  // Group the list the way the manifest declares it (Core, Color Picker, Utility):
  // the manifest is the one source of truth, so a new module lands in a sensible
  // section without this file changing.
  const byGroup = new Map();
  for (const id of moduleIds) {
    const g = moduleGroupOf(id);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(id);
  }
  const order = GROUP_ORDER.filter((g) => byGroup.has(g));
  for (const g of byGroup.keys()) if (!order.includes(g)) order.push(g);
  for (const g of order) {
    const head = document.createElement('div');
    head.className = 'module-group-title';
    head.textContent = GROUP_LABELS[g] ? window.Iro.t(GROUP_LABELS[g]) : g;
    el.moduleList.append(head);
    const ids = byGroup.get(g).sort((a, b) => moduleName(a).localeCompare(moduleName(b)));
    for (const id of ids) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'module-row';
      row.dataset.module = id;

      const light = document.createElement('span');
      light.className = 'module-light';
      // Presence indicator only: green when at least one instance is mounted and
      // visible, grey when every instance is hidden (or none exists). The title
      // says how many, so “hidden” is not silently the same as “never added”.
      const usage = moduleUsageOf(id);
      light.classList.toggle('on', usage.visible > 0);
      light.title = usage.visible > 0
        ? window.Iro.t('settings.modules.mountedCount', { n: usage.visible })
        : (usage.hidden > 0
          ? window.Iro.t('settings.modules.hiddenCount', { n: usage.hidden })
          : window.Iro.t('settings.modules.notMounted'));
      light.setAttribute('role', 'img');
      light.setAttribute('aria-label', light.title);

      const name = document.createElement('span');
      name.className = 'module-name';
      name.textContent = moduleName(id);

      row.append(light, name);
      row.addEventListener('click', () => selectModule(id));
      el.moduleList.append(row);
    }
  }
  if (!selectedModule || !moduleIds.includes(selectedModule)) selectedModule = moduleIds[0] || null;
  renderModuleDetail();
  applySettingsMinWidth();
  requestAnimationFrame(fitWindow);
}

function selectModule(id) {
  if (selectedModule === id) return;
  selectedModule = id;
  selectedInstance = '';
  renderModuleDetail();
  for (const row of el.moduleList.children) row.classList.toggle('selected', row.dataset.module === id);
  requestAnimationFrame(fitWindow);
}

/** The stored locked ratio of an instance, or null (reads the live v1 layout). */
function instanceRatio(instanceId) {
  const cols = [...((boardLayout && boardLayout.columns) || [])];
  for (const f of (boardLayout && boardLayout.floats) || []) cols.push(...(f.columns || []));
  for (const col of cols) {
    for (const m of col.modules || []) {
      if (m.instanceId === instanceId) return Number.isFinite(m.ratio) && m.ratio > 0 ? m.ratio : null;
    }
  }
  return null;
}

/** The Module Size slider, for a module whose height is a locked ratio. */
function renderModuleSizing(container, instanceId, moduleId) {
  const man = window.IroModuleManifest;
  const def = man && man.get ? man.get(moduleId) : null;
  const current = instanceRatio(instanceId);
  if (!current && !(def && def.defaultRatio)) return; // not a locked-ratio module
  const ratio = current || def.defaultRatio;
  const row = document.createElement('div');
  row.className = 'row module-size-row';
  const label = document.createElement('span');
  label.className = 'row-label';
  label.textContent = window.Iro.t('settings.modules.size');
  const rng = document.createElement('input');
  rng.type = 'range';
  rng.className = 'rng module-size-range';
  rng.min = '0.05';
  rng.max = '2.5';
  rng.step = '0.01';
  rng.value = String(ratio);
  rng.setAttribute('aria-label', 'Module size (height relative to width)');
  const num = document.createElement('input');
  num.type = 'number';
  num.className = 'pop-range-input';
  num.min = '0.05';
  num.max = '2.5';
  num.step = '0.01';
  num.value = ratio.toFixed(2);
  num.setAttribute('aria-label', 'Module size (height relative to width)');
  const suffix = document.createElement('span');
  suffix.className = 'pop-range-suffix';
  suffix.textContent = '\u00d7';
  let raf = 0;
  rng.addEventListener('input', () => {
    num.value = Number(rng.value).toFixed(2);
    // One intent per frame: a live drag would otherwise flood main with writes and
    // make the palette re-fit on every pixel.
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      window.csp.setModuleHeight(instanceId, { mode: 'ratio', ratio: Number(rng.value) });
    });
  });
  const commitNum = () => {
    const value = Number(num.value);
    if (!Number.isFinite(value)) { num.value = String(rng.value); return; }
    const clamped = Math.min(2.5, Math.max(0.05, value));
    num.value = clamped.toFixed(2);
    rng.value = String(clamped);
    window.csp.setModuleHeight(instanceId, { mode: 'ratio', ratio: clamped });
  };
  num.addEventListener('change', commitNum);
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
  row.append(label, rng, num, suffix);
  container.append(row);
}

async function renderModuleDetail() {
  if (!el.moduleDetail) return;
  const token = ++detailToken;
  destroyPreview();
  el.moduleDetail.replaceChildren();
  const id = selectedModule;
  if (!id) return;
  const def = (window.Iro.modules && window.Iro.modules[id]) || {};

  const title = document.createElement('div');
  title.className = 'module-detail-title';
  title.textContent = moduleName(id);
  el.moduleDetail.append(title);

  // Every instance of this module, so its settings can be edited per instance
  // (docs/LAYOUT.md, N1). The module's *default* is a hidden template: a new
  // instance is added from it with the ＋ row, and the default itself is never
  // edited here — no "defaults" row, so there is no way to write it by accident.
  // An empty layout means the fetch lost a race with the tab being opened: ask
  // again (the list below is only as good as this data).
  if (!boardLayout || !(boardLayout.columns || []).length) await loadBoardLayout();
  const instances = instancesOf(id);
  // Instances that exist but are mounted nowhere (hidden): they keep their
  // settings, and this is the only place they can be seen or brought back.
  let hiddenInstances = [];
  try { hiddenInstances = (await window.csp.listHidden()) || []; } catch { hiddenInstances = []; }
  hiddenInstances = hiddenInstances.filter((h) => h.moduleId === id);
  // A singleton can never have a second instance, so it has no add row (N2).
  const singleton = window.IroModuleManifest && window.IroModuleManifest.isSingleton
    && window.IroModuleManifest.isSingleton(id);

  const allInstances = [
    ...instances.map((inst) => ({ instanceId: inst.instanceId, where: inst.where, hidden: false })),
    ...hiddenInstances.map((h) => ({ instanceId: h.instanceId, where: 'hidden', hidden: true })),
  ];
  // Keep the selection on a live instance; otherwise the first one. The default
  // is never selected — it is a template, not an editable instance.
  if (!selectedInstance || !allInstances.some((x) => x.instanceId === selectedInstance)) {
    selectedInstance = allInstances[0] ? allInstances[0].instanceId : '';
  }

  // The instance list: a green circle (mounted) or a light grey one (hidden)
  // that toggles it, and the name that selects it — the show/hide control.
  const list = document.createElement('div');
  list.className = 'instance-list';
  if (allInstances.length) {
    allInstances.forEach((inst, i) => {
      const row = document.createElement('div');
      row.className = 'instance-row';
      row.classList.toggle('selected', selectedInstance === inst.instanceId);

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `instance-dot${inst.hidden ? '' : ' on'}`;
      dot.title = inst.hidden ? window.Iro.t('settings.modules.hidden') : window.Iro.t('settings.modules.shown');
      dot.setAttribute('aria-label', dot.title);
      dot.addEventListener('click', async (e) => {
        e.stopPropagation();
        dot.disabled = true;
        await refreshAfterInstanceChange(inst.hidden
          ? await window.csp.showModule(inst.instanceId)
          : await window.csp.hideModule(inst.instanceId));
      });

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'instance-name';
      name.textContent = `${moduleName(id)} ${i + 1}`;
      name.title = inst.where;
      name.addEventListener('click', () => {
        selectedInstance = inst.instanceId;
        renderModuleDetail();
      });

      // Duplicate and delete the instance, right here in the list (the same main-owned
      // intents the module's own ⋯ popup uses). Delete asks twice.
      const dup = layoutIcon('Duplicate this instance', '⧉', async (btn) => {
        btn.disabled = true;
        await refreshAfterInstanceChange(await window.csp.duplicateModule(inst.instanceId));
      });
      const del = layoutIcon('Delete this instance', '✕', async (btn) => {
        if (btn.dataset.armed !== '1') {
          btn.dataset.armed = '1';
          btn.classList.add('armed');
          btn.title = window.Iro.t('settings.modules.confirmDelete');
          return;
        }
        btn.disabled = true;
        await refreshAfterInstanceChange(await window.csp.removeModule(inst.instanceId));
      }, { danger: true });

      row.append(dot, name, dup, del);
      list.append(row);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'module-detail-empty';
    empty.textContent = window.Iro.t('settings.modules.empty');
    list.append(empty);
  }
  if (!singleton) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'instance-add';
    add.textContent = '＋';
    add.title = window.Iro.t('settings.modules.addTitle');
    add.setAttribute('aria-label', 'Add an instance');
    add.addEventListener('click', async () => {
      add.disabled = true;
      await refreshAfterInstanceChange(await window.csp.addModule(id));
    });
    list.append(add);
  }
  el.moduleDetail.append(list);
  if (singleton) {
    const note = document.createElement('div');
    note.className = 'module-detail-empty';
    note.textContent = window.Iro.t('settings.modules.single');
    el.moduleDetail.append(note);
  }
  title.textContent = moduleName(id);

  // The preview is a generic mockup on the module's *defaults*, so it always shows
  // everything the module can render (e.g. every Color Slices panel) no matter what
  // the user has switched off — and it must be here even with no instance mounted:
  // it is what tells the user what the module is for.
  const previewSettings = { ...(def.defaults || {}) };
  await renderModulePreview(id, previewSettings, token);
  if (token !== detailToken) return;

  if (!selectedInstance) {
    // The list above already carries the "No instance mounted" note and the ＋ add
    // control; there is no instance whose settings could be edited.
    for (const row of el.moduleList.children) row.classList.toggle('selected', row.dataset.module === id);
    return;
  }
  renderModuleSizing(el.moduleDetail, selectedInstance, id);
  const api = await moduleSettingsApi(selectedInstance, id);
  if (typeof def.settingsUI === 'function') {
    const body = document.createElement('div');
    body.className = 'module-detail-body';
    el.moduleDetail.append(body);
    def.settingsUI(api, body);
  } else {
    const empty = document.createElement('div');
    empty.className = 'module-detail-empty';
    empty.textContent = window.Iro.t('settings.modules.noSettings');
    el.moduleDetail.append(empty);
  }
  if (window.Iro.settingsTransfer) {
    window.Iro.settingsTransfer({
      root: el.moduleDetail,
      moduleId: id,
      get: api.get,
      patch: api.patch,
      rebuild: () => { renderModuleDetail(); },
    });
  }
  for (const row of el.moduleList.children) row.classList.toggle('selected', row.dataset.module === id);
}


/** A small icon button for the Layout rows (duplicate / export / delete / …). */
function layoutIcon(title, glyph, onClick, opts = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn tiny icon-only layout-icon';
  if (opts.danger) b.classList.add('danger');
  b.textContent = glyph;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(b);
  });
  return b;
}

/** One module instance inside a palette, with its disable / popout / remove icons. */
function paletteMemberRow(m, refresh) {
  const row = document.createElement('div');
  row.className = 'palette-member';
  const label = document.createElement('span');
  label.className = 'palette-member-name';
  label.textContent = moduleName(m.moduleId);
  label.title = m.instanceId;

  const hide = layoutIcon('Disable — hide this module (bring it back in Settings → Modules)', '◐',
    () => window.csp.hideModule(m.instanceId).then(refresh));

  const pop = layoutIcon('Pop out into its own window', '⤢',
    () => window.csp.requestModuleAction({ instanceId: m.instanceId, action: 'float' }));

  const rem = layoutIcon('Remove this module', '✕', (btn) => {
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.classList.add('armed');
      btn.title = window.Iro.t('settings.modules.confirmRemove');
      return;
    }
    window.csp.removeModule(m.instanceId).then(refresh);
  }, { danger: true });

  row.append(label, hide, pop, rem);
  return row;
}

/** The Layout tab: every palette (with its modules), plus export/import (N3). */
async function renderLayoutTab() {
  const list = document.getElementById('palette-list');
  const note = document.getElementById('layout-note');
  if (!list) return;
  let palettes = [];
  try { palettes = (await window.csp.listPalettes()) || []; } catch { palettes = []; }
  const refresh = () => renderLayoutTab();
  list.replaceChildren();
  palettes.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.dataset.palette = p.id;

    const row = document.createElement('div');
    row.className = 'row palette-row';

    const members = document.createElement('div');
    members.className = 'palette-members hidden';

    const arrow = layoutIcon('Show the modules in this palette', '▸', (btn) => {
      const hidden = members.classList.toggle('hidden');
      btn.textContent = hidden ? '▸' : '▾';
      btn.setAttribute('aria-expanded', String(!hidden));
      requestAnimationFrame(fitWindow);
    });
    arrow.classList.add('palette-expand');

    const name = document.createElement('input');
    name.className = 'text-input palette-name';
    name.value = p.name || '';
    name.spellcheck = false;
    name.maxLength = 60;
    name.setAttribute('aria-label', `Palette ${i + 1} name`);
    const commit = () => {
      const wanted = name.value.trim();
      if (!wanted || wanted === p.name) return;
      window.csp.renamePaletteById({ paletteId: p.id, name: wanted }).then((res) => {
        if (!res || !res.ok) name.value = p.name;
      });
    };
    name.addEventListener('change', commit);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

    const count = document.createElement('span');
    count.className = 'row-label palette-count';
    count.textContent = p.modules === 1 ? '1 module' : `${p.modules} modules`;

    const dup = layoutIcon('Duplicate this palette', '⧉',
      (btn) => { btn.disabled = true; window.csp.duplicatePalette(p.id).then(refresh); });
    const exp = layoutIcon('Export this palette', '⤓',
      () => window.csp.exportPalette({ paletteId: p.id }).then((res) => {
        if (note) note.textContent = res && res.ok ? `Exported “${p.name}” to ${res.path}` : window.Iro.t('settings.file.exportCancelled');
      }));
    const del = layoutIcon('Delete this palette', '✕', (btn) => {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.classList.add('armed');
        btn.title = window.Iro.t('settings.modules.confirmDelete');
        return;
      }
      window.csp.deletePaletteById(p.id).then((res) => {
        if (res && res.ok === false && note) note.textContent = res.error || window.Iro.t('settings.palette.deleteFailed');
        refresh();
      });
    }, { danger: true });

    row.append(arrow, name, count, dup, exp, del);
    (p.members || []).forEach((m) => members.append(paletteMemberRow(m, refresh)));
    item.append(row, members);
    list.append(item);
  });
  if (note) {
    note.textContent = palettes.length > 1
      ? `${palettes.length} palettes. A copy keeps the modules but gets its own instance settings.`
      : 'One palette. Duplicating one opens a second window with the same modules.';
  }
  renderWorkspaces();
}

/** Saved named workspaces (Settings → Layout): load, rename, delete. */
async function renderWorkspaces() {
  const list = document.getElementById('workspace-list');
  if (!list) return;
  let items = [];
  try { items = (await window.csp.namedWorkspaces()) || []; } catch { items = []; }
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = window.Iro.t('settings.workspace.empty');
    list.append(empty);
    return;
  }
  for (const w of items) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    const row = document.createElement('div');
    row.className = 'row palette-row';

    const name = document.createElement('input');
    name.className = 'text-input palette-name';
    name.value = w.name || '';
    name.spellcheck = false;
    name.maxLength = 60;
    name.setAttribute('aria-label', 'Workspace name');
    const commit = () => {
      const wanted = name.value.trim();
      if (!wanted || wanted === w.name) return;
      window.csp.renameNamedWorkspace(w.id, wanted).then(renderWorkspaces);
    };
    name.addEventListener('change', commit);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

    const load = layoutIcon('Load this workspace', '↧', (btn) => {
      btn.disabled = true;
      window.csp.loadNamedWorkspace(w.id).then((res) => {
        const note = document.getElementById('layout-note');
        if (note) note.textContent = res && res.ok ? `Loaded “${w.name}”.` : window.Iro.t('settings.workspace.loadFailed');
        renderLayoutTab();
      });
    });
    const del = layoutIcon('Delete this workspace', '✕', (btn) => {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.classList.add('armed');
        btn.title = window.Iro.t('settings.modules.confirmDelete');
        return;
      }
      window.csp.deleteNamedWorkspace(w.id).then(renderWorkspaces);
    }, { danger: true });

    row.append(name, load, del);
    item.append(row);
    list.append(item);
  }
}


// The per-module command shortcuts. The catalog comes from main (which resolves each
// mounted instance's module name); each row binds one command to a system-wide key.
// The list is rebuilt only when the catalog changes and no field is being edited, so
// a keypress does not steal focus by re-rendering the row under the pointer.
let commandCatalogSig = '';

async function renderCommandList() {
  if (!el.commandList) return;
  let list = [];
  try { list = await csp.shortcutCatalog(); } catch { list = []; }
  list = Array.isArray(list) ? list : (list && list.commands) || [];
  if (!Array.isArray(list)) list = [];
  const sig = list.map((e) => `${e.instanceId}:${e.command}`).join('|');
  if (el.commandList.contains(document.activeElement)) return;
  if (sig === commandCatalogSig && el.commandList.childElementCount > 0) return;
  commandCatalogSig = sig;
  el.commandList.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'command-empty';
    empty.textContent = window.Iro.t('settings.commands.empty');
    el.commandList.append(empty);
    return;
  }
  const bindings = (liveSettings && liveSettings.commandBindings) || {};
  for (const entry of list) {
    const key = `${entry.instanceId}:${entry.command}`;
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = `${entry.name} · ${entry.command}`;
    const input = document.createElement('input');
    input.className = 'text-input hotkey-input';
    input.readOnly = true;
    input.spellcheck = false;
    input.placeholder = window.Iro.t('settings.commands.none');
    input.value = bindings[key] || '';
    input.setAttribute('aria-label', `${entry.name} ${entry.command} shortcut`);
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', async (e) => {
      e.preventDefault();
      const clearing = e.key === 'Escape';
      const accel = clearing ? '' : summonAccelerator(e);
      if (!clearing && !accel) return;
      const res = await csp.setCommandBinding(key, accel);
      if (res && res.ok) {
        input.value = accel;
        input.classList.remove('invalid');
        input.title = window.Iro.t('settings.commands.recordHint');
      } else {
        input.classList.add('invalid');
        input.title = window.Iro.t('settings.commands.taken');
      }
    });
    row.append(label, input);
    el.commandList.append(row);
  }
}

/**
 * A KeyboardEvent as an Electron accelerator, or '' when it is unusable: a
 * modifier-only press, an unsupported key, or a plain key with no modifier
 * (which would swallow typing system-wide). Esc is handled by the caller.
 */
function summonAccelerator(e) {
  const NAMED = {
    ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', '+': 'Plus', '-': 'Minus',
    '=': 'Equal', ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote',
    '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote',
  };
  let main = NAMED[e.key];
  if (!main && /^[a-z0-9]$/i.test(e.key)) main = e.key.toUpperCase();
  if (!main && /^F([1-9]|1[0-9]|2[0-4])$/i.test(e.key)) main = e.key.toUpperCase();
  if (!main) return '';
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (mods.length === 0 && !/^F\d{1,2}$/.test(main)) return '';
  mods.push(main);
  return mods.join('+');
}

function wire() {
  // A module deleted or duplicated elsewhere (its own ⋯ popup, another palette
  // window) changes the instance list this tab is built from, so re-read the
  // layout and re-render whatever tab is showing.
  csp.onLayoutChanged?.(() => {
    if (activeTab !== 'modules' && activeTab !== 'layout') return;
    loadBoardLayout().then(() => {
      refreshModuleLights();
      if (activeTab === 'modules') renderModuleDetail();
      else renderLayoutTab();
    });
  });
  for (const btn of document.querySelectorAll('.seg-btn[data-tab]')) {
    btn.addEventListener('click', () => {
      selectTab(btn.dataset.tab);
      // Remember the tab across restarts (a new settings key, additive).
      window.csp.updateSettings({ settingsTab: btn.dataset.tab });
    });
  }

  el.setTheme.addEventListener('change', () => csp.updateSettings({ theme: el.setTheme.value }));
  el.setLanguage.addEventListener('change', () => csp.updateSettings({ language: el.setLanguage.value }));

  el.btnAccent.addEventListener('click', openAccentPopup);
  // The Layout tab's own controls; the list itself renders from `selectTab`.
  document.getElementById('btn-export-ws')?.addEventListener('click', () => {
    window.csp.exportWorkspace({}).then((res) => {
      const note = document.getElementById('layout-note');
      if (note) note.textContent = res && res.ok ? `Exported to ${res.path}` : window.Iro.t('settings.file.exportCancelled');
    });
  });
  document.getElementById('btn-import-ws')?.addEventListener('click', () => {
    window.csp.importWorkspace({}).then((res) => {
      const note = document.getElementById('layout-note');
      if (note) note.textContent = res && res.ok ? `Imported from ${res.path}` : window.Iro.t('settings.file.importCancelled');
      renderLayoutTab();
    });
  });
  document.getElementById('btn-import-palette')?.addEventListener('click', () => {
    window.csp.importPalette({}).then((res) => {
      const note = document.getElementById('layout-note');
      if (note) note.textContent = res && res.ok ? `Imported a palette from ${res.path}` : window.Iro.t('settings.file.importCancelled');
      renderLayoutTab();
    });
  });
  document.getElementById('btn-save-workspace')?.addEventListener('click', () => {
    const input = document.getElementById('workspace-name');
    const name = input ? input.value.trim() : '';
    if (!name) { if (input) input.focus(); return; }
    window.csp.saveNamedWorkspace(name).then((res) => {
      const note = document.getElementById('layout-note');
        if (note) note.textContent = res && res.ok ? `Saved “${res.workspace.name}”.` : window.Iro.t('settings.file.saveFailed');
      if (input) input.value = '';
      renderWorkspaces();
    });
  });
  // Settings export / import (General tab): a plain settings.json bundle.
  document.getElementById('btn-export-settings')?.addEventListener('click', () => {
    window.csp.exportSettings({}).then((res) => {
      const note = document.getElementById('settings-note');
      if (note) note.textContent = res && res.ok ? `Exported to ${res.path}` : window.Iro.t('settings.file.exportCancelled');
    });
  });
  document.getElementById('btn-import-settings')?.addEventListener('click', () => {
    window.csp.importSettings({}).then((res) => {
      const note = document.getElementById('settings-note');
      if (note) note.textContent = res && res.ok ? `Imported from ${res.path}` : window.Iro.t('settings.file.importCancelled');
      if (res && res.ok) applySettings(res.settings);
    });
  });
  el.btnAccentReset.addEventListener('click', () => {
    const next = { ...accents };
    delete next[themeId];
    commitAccents(next);
  });
  el.accentBackdrop.addEventListener('click', closeAccentPopup);
  el.accentCancel.addEventListener('click', closeAccentPopup);
  el.accentSave.addEventListener('click', () => {
    const hex = accentHsvHex();
    const next = { ...accents };
    if (hex.toLowerCase() === themeOwnAccent().toLowerCase()) delete next[themeId];
    else next[themeId] = hex;
    commitAccents(next);
    closeAccentPopup();
  });
  el.accentHue.addEventListener('input', () => {
    accentHsv = { ...accentHsv, h: Number(el.accentHue.value) };
    renderAccentPopup();
  });
  el.accentHex.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.accentHex.blur(); });
  el.accentHex.addEventListener('change', () => {
    const rgb = Color.hexToRgb(el.accentHex.value);
    if (!rgb) { renderAccentPopup(); return; }
    accentHsv = Color.rgbToHsv(rgb.r / 255, rgb.g / 255, rgb.b / 255);
    renderAccentPopup();
  });
  const svAt = (ev) => {
    const rect = el.accentSv.getBoundingClientRect();
    accentHsv = {
      ...accentHsv,
      s: clamp((ev.clientX - rect.left) / rect.width, 0, 1),
      v: 1 - clamp((ev.clientY - rect.top) / rect.height, 0, 1),
    };
    renderAccentPopup();
  };
  el.accentSv.addEventListener('pointerdown', (ev) => {
    svDragging = true;
    el.accentSv.setPointerCapture(ev.pointerId);
    svAt(ev);
    ev.preventDefault();
  });
  el.accentSv.addEventListener('pointermove', (ev) => { if (svDragging) svAt(ev); });
  const svEnd = () => { svDragging = false; };
  el.accentSv.addEventListener('pointerup', svEnd);
  el.accentSv.addEventListener('pointercancel', svEnd);

  $('settings-close').addEventListener('click', () => { destroyPreview(); csp.closeSettings(); });
  el.btnConn.addEventListener('click', () => {
    if (connState === 'connected') csp.disconnect(false);
    else if (connState === 'scanning') csp.cancelScan();
    else csp.pair().catch(() => {});
  });
  el.btnReconnect.addEventListener('click', () => csp.reconnect().catch(() => {}));
  el.btnForget.addEventListener('click', () => csp.disconnect(true));
  $('btn-use-url').addEventListener('click', () => {
    const val = el.qrUrl.value.trim();
    if (val) csp.pairWithPayload(val).catch(() => {});
  });
  $('btn-quit').addEventListener('click', () => csp.quit());

  el.setLive.addEventListener('change', () => csp.updateSettings({ liveSync: el.setLive.checked }));
  el.setAutoHide.addEventListener('change', () => csp.updateSettings({ autoHide: el.setAutoHide.checked }));
  el.setNames.addEventListener('change', () => csp.updateSettings({ hideModuleNames: el.setNames.checked }));
  el.setAutoConnect.addEventListener('change', () => csp.updateSettings({ autoConnect: el.setAutoConnect.checked }));
  el.setProfileDefault.addEventListener('click', () => chooseProfile(''));
  if (el.setProfileBrowse) el.setProfileBrowse.addEventListener('click', browseProfile);
  el.setLogin.addEventListener('change', () => csp.updateSettings({ launchAtLogin: el.setLogin.checked }));
  // The summon hotkey: capture the keys (never typing into the box) and hand the
  // accelerator to main, which registers it and reports whether it took.
  el.setSummon.addEventListener('focus', () => el.setSummon.select());
  el.setSummon.addEventListener('keydown', async (e) => {
    e.preventDefault();
    if (e.key === 'Escape') {
      const res = await csp.setSummonHotkey('');
      if (res && res.ok) { el.setSummon.value = ''; el.setSummon.classList.remove('invalid'); }
      return;
    }
    const accel = summonAccelerator(e);
    if (!accel) return;
    const res = await csp.setSummonHotkey(accel);
    if (res && res.ok) {
      el.setSummon.value = res.accelerator || '';
      el.setSummon.classList.remove('invalid');
      el.setSummon.title = window.Iro.t('settings.commands.recordHint');
    } else {
      el.setSummon.classList.add('invalid');
      el.setSummon.title = window.Iro.t('settings.commands.taken');
    }
  });
  el.setCross.addEventListener('change', () => csp.updateSettings({ crosshair: el.setCross.checked }));

  el.setUiScale.addEventListener('input', () => {
    // One update per frame: each step persists settings and re-zooms both windows.
    if (scaleFrame) return;
    scaleFrame = requestAnimationFrame(() => {
      scaleFrame = null;
      setScale(Number(el.setUiScale.value));
    });
  });
  el.uiScaleValue.addEventListener('change', () => {
    const pct = Number(String(el.uiScaleValue.value).replace(/[^0-9.]/g, ''));
    setScale((Number.isFinite(pct) && pct > 0 ? pct : 100) / 100);
  });
  el.uiScaleValue.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.uiScaleValue.blur(); });
  el.btnScaleUp.addEventListener('click', () => setScale(currentScale() + 0.01));
  el.btnScaleDown.addEventListener('click', () => setScale(currentScale() - 0.01));
  el.btnScaleReset.addEventListener('click', () => setScale(1));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (accentPopupOpen()) closeAccentPopup();
    else { destroyPreview(); csp.closeSettings(); }
  });
  // A UI-scale change re-zooms the contents; re-fit when the viewport changes.
  window.addEventListener('resize', () => requestAnimationFrame(fitWindow));

  csp.onStatus(updateStatus);
  csp.onSettings(applySettings);
  csp.onUpdate(showUpdate);
  el.update.addEventListener('click', () => {
    if (updateUrl) csp.openExternal(updateUrl).catch(() => {});
  });
  el.check.addEventListener('click', checkUpdates);
}

async function init() {
  wire();
  await themeRegistry.load();
  populateThemes();
  populateLanguages();
  await loadProfiles();
  await loadModules();
  renderModules();
  const snap = await csp.snapshot();
  previewColor = snap.color || null;
  // Load the catalog *before* the first paint: `applySettings` asks for it without
  // awaiting, and a tab rendered first (Layout's empty-workspace line, a module
  // preview) would otherwise print the raw key until something re-rendered it.
  const initialLanguage = snap.settings.language || navigator.language || 'en';
  try {
    await window.Iro.i18n.use(initialLanguage);
    appliedLanguage = initialLanguage;
  } catch { /* English fallback */ }
  applySettings(snap.settings);
  // Reopen where the user left it; Appearance is only the first-run default.
  selectTab(snap.settings.settingsTab || 'appearance');
  updateStatus(snap.status);
  csp.getVersion().then((v) => { el.version.textContent = `Iroiroppa v${v}`; }).catch(() => {});
  csp.getUpdate().then(showUpdate).catch(() => {});
  if (csp.onModuleChanged) csp.onModuleChanged(({ id } = {}) => invalidateModule(id));
  fitWindow();
  setTimeout(fitWindow, 80);
}

init();
