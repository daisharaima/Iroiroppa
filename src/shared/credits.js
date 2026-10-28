/*
 * The app's credits and outbound-link allowlist, in one place.
 *
 * The About tab renders this list and `src/main/ipc/app.js` only lets the renderer
 * open a URL that is in here (or a page of this repository), so a stray link in a
 * credit cannot turn into an arbitrary browser navigation.
 *
 * Loads as CommonJS in Node and as a global `IroCredits` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroCredits = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REPO = 'https://github.com/daisharaima/Iroiroppa';

  const links = {
    repo: REPO,
    releases: `${REPO}/releases`,
    latest: `${REPO}/releases/latest`,
    issues: `${REPO}/issues`,
    contributing: `${REPO}/blob/main/CONTRIBUTING.md`,
    guide: `${REPO}/blob/main/wiki/Home.md`,
    changelog: `${REPO}/blob/main/CHANGELOG.md`,
    license: `${REPO}/blob/main/LICENSE`,
    thirdParty: `${REPO}/blob/main/THIRD_PARTY.md`,
    author: 'https://github.com/daisharaima',
  };

  /**
   * name    — what it is
   * role    — why Iroiroppa uses it (short, user-facing)
   * license — SPDX-ish name, or '' when it is inspiration only
   * url     — the source, when one exists
   */
  const credits = [
    {
      name: 'chocolatkey/clipremote',
      role: 'Reference for the Clip Studio Paint Companion Mode wire protocol',
      license: 'MIT',
      url: 'https://github.com/chocolatkey/clipremote',
    },
    {
      name: 'LumaPaletteCSP',
      role: 'An earlier OKLCH picker for Clip Studio Paint; protocol notes and inspiration',
      license: 'GPL-3.0',
      url: 'https://github.com/andyubird/LumaPaletteCSP',
    },
    {
      name: 'Björn Ottosson',
      role: 'OKLab, OKLCH, OKHSV and OKHSL colour spaces',
      license: 'MIT',
      url: 'https://bottosson.github.io/posts/oklab/',
    },
    {
      name: 'Helmlab',
      role: 'GenSpace and MetricSpace colour spaces (vendored)',
      license: 'MIT',
      url: 'https://helmlab.space/',
    },
    {
      name: 'culori',
      role: 'Colour conversion and the test oracle (vendored)',
      license: 'MIT',
      url: 'https://github.com/Evercoder/culori',
    },
    {
      name: 'jsQR',
      role: 'QR decoding for Companion pairing',
      license: 'Apache-2.0',
      url: 'https://github.com/cozmo/jsQR',
    },
    {
      name: 'jsColorEngine',
      role: 'ICC profile and CMYK proofing engine',
      license: 'MPL-2.0',
      url: 'https://github.com/glennwilton/jsColorEngine',
    },
    {
      name: 'Electron',
      role: 'The desktop application shell',
      license: 'MIT',
      url: 'https://www.electronjs.org/',
    },
    {
      name: 'electron-builder',
      role: 'Installer and portable packaging',
      license: 'MIT',
      url: 'https://www.electron.build/',
    },
    {
      name: 'Inter',
      role: 'The interface typeface',
      license: 'SIL OFL 1.1',
      url: 'https://github.com/rsms/inter',
    },
    {
      name: 'DejaVu Sans',
      role: 'Fallback glyphs for scripts the interface font lacks',
      license: 'Bitstream Vera / Arev',
      url: 'https://dejavu-fonts.github.io/',
    },
    {
      name: 'lcms-wasm',
      role: 'A test-only ICC reference (not shipped)',
      license: 'MIT',
      url: 'https://github.com/mattdesl/lcms-wasm',
    },
    {
      name: 'PaintPalette',
      role: 'Palette interface inspiration by echo-tree',
      license: '',
      url: '',
    },
    {
      name: 'Kroma',
      role: 'Palette interface inspiration by 秫稻_',
      license: '',
      url: '',
    },
  ];

  const ALLOWED_URLS = new Set([
    ...Object.values(links),
    ...credits.map((c) => c.url).filter(Boolean),
  ]);

  return { REPO, links, credits, ALLOWED_URLS };
});
