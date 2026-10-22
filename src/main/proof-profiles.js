'use strict';

// Colour-profile discovery for proofing: the configured profile, the machine's
// Adobe RGB (1998), and the synthetic ICC the repo ships. Electron-free — the
// caller injects the app-data directory and the settings store — so the
// discovery and the parses are testable headlessly.

const fs = require('node:fs');
const path = require('node:path');

const Proof = require('../shared/proof');

// The CMYK engine is heavy and only needed for a non-matrix/TRC profile, so it is
// loaded on first use — a matrix-only install never pays for it.
let cmykEngine = null;
const cmyk = () => { if (!cmykEngine) cmykEngine = require('./cmyk'); return cmykEngine; };

const COLOUR_DIR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'spool', 'drivers', 'color');
// The bundled synthetic profile; relative to this file so it resolves inside
// app.asar too (package.json ships `src/**`).
const BUNDLED_PROFILE = path.join(__dirname, '..', 'assets', 'synthetic.icc');

/** Describe one profile file for the picker (name, support, error). */
function describeProfileFile(file) {
  if (!file || !fs.existsSync(file)) {
    return { path: file, name: file ? path.basename(file) : '', dir: file ? path.dirname(file) : '', supported: false, error: 'file not found' };
  }
  try {
    const bytes = fs.readFileSync(file);
    const profile = Proof.parseIcc(bytes);
    if (profile.colorants) {
      return {
        path: file,
        name: (profile.description || '').trim() || path.basename(file),
        dir: path.dirname(file),
        supported: true,
        kind: 'matrix',
      };
    }
    // No colorant matrix: hand it to the CMYK engine.
    const loaded = cmyk().loadProfile(bytes);
    return {
      path: file,
      name: (profile.description || '').trim() || path.basename(file),
      dir: path.dirname(file),
      supported: loaded.ok,
      kind: loaded.ok ? 'lut' : undefined,
      error: loaded.ok ? undefined : (loaded.error || 'unsupported profile'),
    };
  } catch (err) {
    return { path: file, name: path.basename(file), dir: path.dirname(file), supported: false, error: err.message };
  }
}

/**
 * @param {object} opts
 * @param {object} opts.settings the JsonStore holding `proofProfile`/`proofProfiles`
 * @param {string} [opts.colourDir]
 * @param {string} [opts.bundledProfile]
 */
function createProofStore({ settings, colourDir = COLOUR_DIR, bundledProfile = BUNDLED_PROFILE }) {
  let proofCache = null;
  let proofListCache = null;

  function loadProofProfile() {
    const p = settings.get().proofProfile;
    if (!p) return { ok: false, path: '', error: 'no proof profile configured' };
    try {
      const bytes = fs.readFileSync(p);
      const profile = Proof.parseIcc(bytes);
      if (profile.colorants) return { ok: true, path: p, profile };
      // A LUT/CMYK profile: bake the grids the renderer interpolates.
      return {
        ok: true,
        path: p,
        profile: { description: profile.description, kind: 'lut', lut: bakeCmyk(p, bytes) },
      };
    } catch (err) {
      return { ok: false, path: p, error: err.message };
    }
  }

  // Bake (and cache) a profile's sRGB<->CMYK grids, keyed by path + mtime.
  let cmykCache = null;
  function bakeCmyk(file, bytes) {
    let stamp = '';
    try { stamp = String(fs.statSync(file).mtimeMs); } catch { /* no stat */ }
    const key = `${file}:${stamp}`;
    if (cmykCache && cmykCache.key === key) return cmykCache.grids;
    const grids = cmyk().bakeGrids(bytes);
    cmykCache = { key, grids };
    return grids;
  }

  /**
   * The profile a new install starts on: the machine's Adobe RGB (1998) profile
   * when it has one, so the picker proves through a sensible default instead of
   * starting with none. Existing installs are unaffected — a stored
   * `settings.json` always wins over this default.
   * @returns {string} an absolute path, or '' when no usable profile is found
   */
  function findAdobeRgbProfile() {
    let names;
    try {
      names = fs.readdirSync(colourDir);
    } catch {
      return '';
    }
    const name = Proof.pickAdobeRgbProfileName(names);
    if (!name) return '';
    const file = path.join(colourDir, name);
    return describeProfileFile(file).supported ? file : '';
  }

  function findBundledProfile() {
    return describeProfileFile(bundledProfile).supported ? bundledProfile : '';
  }

  function getProof() {
    const p = settings.get().proofProfile;
    if (!proofCache || proofCache.path !== p) proofCache = loadProofProfile();
    return proofCache;
  }

  /** Current profile first, then recent picks, then the Windows colour directory. */
  function listProofProfiles() {
    if (proofListCache) return proofListCache;
    const s = settings.get();
    const seen = new Set();
    const out = [];
    const add = (file, force = false) => {
      if (!file) return;
      const key = path.normalize(file).toLowerCase();
      if (seen.has(key)) return;
      if (!force && !fs.existsSync(file)) return;
      seen.add(key);
      out.push(describeProfileFile(file));
    };

    add(s.proofProfile, true);
    for (const r of s.proofProfiles || []) add(r);
    add(bundledProfile);
    try {
      for (const f of fs.readdirSync(colourDir)) {
        if (/\.(icc|icm)$/i.test(f)) add(path.join(colourDir, f));
      }
    } catch { /* the colour directory may not exist */ }

    proofListCache = out;
    return out;
  }

  /** Drop both caches (the configured profile changed). */
  function clearCaches() {
    proofCache = null;
    proofListCache = null;
    cmykCache = null;
  }

  return {
    describeProfileFile,
    loadProofProfile,
    findAdobeRgbProfile,
    findBundledProfile,
    getProof,
    listProofProfiles,
    clearCaches,
  };
}

module.exports = { createProofStore, describeProfileFile, COLOUR_DIR, BUNDLED_PROFILE };
