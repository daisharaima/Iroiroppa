'use strict';

// Theme validation, shared by `scripts/theme-check.js` and the theme test so the
// command line and CI agree on what "valid" means. Pure and Electron-free.

const T = require('./theme-tokens');

/** `#rgb` / `#rrggbb` -> [r, g, b], else null. */
function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(rgb) {
  const lin = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** WCAG contrast ratio, or null when either side is not a plain hex colour. */
function contrast(a, b) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const la = luminance(ca);
  const lb = luminance(cb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Text pairs worth reading in any theme. Failure is a warning, not an error: a
// theme may deliberately go low-contrast, but it should be a decision.
const CONTRAST_PAIRS = [
  ['--text', '--bg', 4.5],
  ['--text', '--card', 4.5],
  ['--text-strong', '--bg', 4.5],
  ['--text-dim', '--bg', 3],
];

/**
 * Validate one parsed theme.
 * @param {object} theme
 * @param {{partial?: boolean}} [opts] partial allows a user theme to omit tokens.
 * @returns {{errors: string[], warnings: string[]}}
 */
function validateTheme(theme, opts = {}) {
  const partial = Boolean(opts.partial);
  const errors = [];
  const warnings = [];
  if (!theme || typeof theme !== 'object') {
    return { errors: ['theme is not an object'], warnings };
  }
  if (!theme.id || typeof theme.id !== 'string') errors.push('missing id');
  if (!theme.name || typeof theme.name !== 'string') warnings.push('missing name (the id is shown)');
  if (typeof theme.dark !== 'boolean') warnings.push('missing dark flag (reads as light)');
  const tokens = theme.tokens;
  if (!tokens || typeof tokens !== 'object') {
    errors.push('missing tokens object');
    return { errors, warnings };
  }

  const known = new Set(T.ids());
  for (const t of T.TOKENS) {
    const has = Object.prototype.hasOwnProperty.call(tokens, t.id);
    if (!has) {
      if (partial || !t.required) warnings.push('missing ' + t.id);
      else errors.push('missing ' + t.id);
      continue;
    }
    const value = tokens[t.id];
    if (t.type === 'font') {
      if (typeof value !== 'string' || !value.trim()) errors.push(t.id + ' is not a font stack');
    } else if (t.type === 'length') {
      if (!T.isLength(value)) {
        errors.push(t.id + ' is not a length: ' + JSON.stringify(value));
      } else {
        const px = T.lengthPx(value);
        if (px !== null && t.min !== undefined && px < t.min) warnings.push(t.id + ' is below ' + t.min + 'px (reads as too small)');
        if (px !== null && t.max !== undefined && px > t.max) warnings.push(t.id + ' is above ' + t.max + 'px (reads as too large)');
      }
    } else if (!T.isColor(value)) {
      const line = t.id + ' is not a colour: ' + JSON.stringify(value);
      if (t.type === 'shadow') warnings.push(line);
      else errors.push(line);
    }
  }
  for (const key of Object.keys(tokens)) {
    if (!known.has(key) && !T.LOCAL_VARS.includes(key)) warnings.push('unknown token ' + key);
  }

  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    if (!Object.prototype.hasOwnProperty.call(tokens, fg) || !Object.prototype.hasOwnProperty.call(tokens, bg)) continue;
    const ratio = contrast(tokens[fg], tokens[bg]);
    if (ratio !== null && ratio < min) {
      warnings.push(fg + ' on ' + bg + ' is ' + ratio.toFixed(2) + ':1 (want ' + min + ')');
    }
  }
  return { errors, warnings };
}

// --- theme CSS budget ------------------------------------------------------

// A theme's CSS is expressive but must stay cheap and must not move layout: any
// property that can change geometry belongs to a structural token instead (see
// docs/THEMES.md). These are heuristics over the declaration text, not a CSS
// parser — a cleverly written rule can slip past; bundled themes are checked
// strictly, user themes get warnings.
const FORBIDDEN_PROPS = [
  /^animation(-|$)/,
  /^transition(-|$)/,
  /^filter$/,
  /^backdrop-filter$/,
  /^will-change$/,
];
const LAYOUT_PROPS = [
  /^width$/, /^height$/, /^min-(width|height)$/, /^max-(width|height)$/,
  /^padding(-|$)/, /^margin(-|$)/, /^font-size$/, /^line-height$/, /^letter-spacing$/,
  /^gap$/, /^(row|column)-gap$/, /^display$/, /^position$/, /^inset(-|$)/,
  /^(top|right|bottom|left)$/, /^flex(-|$)/, /^grid(-|$)/,
  /^border(-(top|right|bottom|left))?(-width)?$/, /^aspect-ratio$/, /^order$/,
];

/**
 * Lint a theme's CSS against the budget.
 * @param {string} css
 * @param {{strict?: boolean}} [opts] strict (bundled) turns findings into errors.
 * @returns {{errors: string[], warnings: string[]}}
 */
function validateThemeCss(css, opts = {}) {
  const strict = Boolean(opts.strict);
  const errors = [];
  const warnings = [];
  const text = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/([a-z-]+)\s*:/gi)) {
    const prop = m[1].toLowerCase();
    let reason = '';
    if (FORBIDDEN_PROPS.some((re) => re.test(prop))) reason = 'is forbidden in a theme (per-frame cost)';
    else if (LAYOUT_PROPS.some((re) => re.test(prop))) reason = 'changes layout; use a structural token instead';
    if (!reason) continue;
    const line = prop + ' ' + reason;
    if (strict) errors.push(line); else warnings.push(line);
  }
  for (const m of text.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)) {
    const layers = m[1].split(/,(?![^(]*\))/).filter((s) => s.trim()).length;
    if (layers > 3) {
      const line = 'box-shadow has ' + layers + ' layers (cap is 3)';
      if (strict) errors.push(line); else warnings.push(line);
    }
  }
  return { errors, warnings };
}

module.exports = { validateTheme, validateThemeCss, contrast, parseHex };
