/*
 * Readable names for CSP's internal menucommand ids.
 *
 * CSP's shortcut files store only ids such as `filenewfromclipboard`; the
 * user-data label table (`workspacetoolbaritem`) covers only commands placed on a
 * toolbar. This resolver uses (1) the live CSP label when one is available,
 * (2) a curated map for common commands, and (3) a tokenising fallback so the
 * list never shows a raw lowercase id. The raw id stays in the row tooltip.
 *
 * Loads as CommonJS in Node and as a global `IroCspCommandNames` in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IroCspCommandNames = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Exact CSP names for common commands. Local toolbar labels take precedence.
  const EXACT = {
    applicationquit: 'Quit CLIP STUDIO PAINT',
    applicationtilingmenu: 'Display application menu',
    applicationremotecontrollerconnection: 'Connect to smartphone',
    applicationlicenserecheck: 'Recheck license',
    filebootclipstudio: 'Open CLIP STUDIO',
    filenew: 'New',
    filenewfromclipboard: 'New from Clipboard',
    filenewfrommovie: 'New from Movie',
    filenewfromphotolibrary: 'New from Photo Library',
    fileopen: 'Open',
    fileopenrecoveryfiles: 'Open Recovery Files',
    filerecentfiles: 'Open Recent',
    fileclose: 'Close Window',
    filesave: 'Save',
    filesaveas: 'Save As',
    filesaveforeground: 'Save Foreground',
    filequickshare: 'Quick Share',
    filesavemergeimagejpg: 'Export as JPEG',
    filesavemergeimagepng: 'Export as PNG',
    filefilemanagement: 'File Management',
    undo: 'Undo',
    redo: 'Redo',
    clear: 'Delete',
    editpaint: 'Fill',
    editclearoutofselectarea: 'Delete Outside Selection',
    editbordering: 'Outline Selection',
    transformstretch: 'Scale / Rotate',
    transformmesh: 'Mesh Transformation',
    selectdeselect: 'Deselect',
    selectinvert: 'Invert Selected Area',
    selectshow: 'Show Selection Border',
    selectcolor: 'Select Color Gamut',
    selecttostock: 'Convert to Selection Layer',
    layerlockalpha: 'Lock Transparent Pixels',
    layerselectfromlayermultiply: 'Select from Layer',
    viewsnapruler: 'Snap to Ruler',
    viewsnapspecialruler: 'Snap to Special Ruler',
    viewsnapgrid: 'Snap to Grid',
    viewtogglespecialrulersnap: 'Toggle Special Ruler Snapping',
    viewgrid: 'Show Grid',
    viewrulerbar: 'Show Ruler Bar',
    viewrotate0: 'Reset Rotation',
    viewreversehorz: 'Flip Horizontal',
    viewreset: 'Reset Display',
    viewcolorpreview: 'Preview Color Profile',
    viewcolorpreviewsetting: 'Color Profile Preview Settings',
    windowswitchscreenmode: 'Show/Hide Title and Menu Bar',
    windowautovisibleworktab: 'Always Show Canvas Tab',
    windowlockdockwidth: 'Fix Palette Dock Width',
    pagechangeresolution: 'Change Image Resolution',
    pagechangecanvassize: 'Change Canvas Size',
    toolpressuretosize: 'Link Pen Pressure to Brush Size',
    toolpressuretoflow: 'Link Pen Pressure to Brush Density',
    toolbrushusewatercolor: 'Toggle Color Mixing',
    toolbrushuserevision: 'Toggle Post Correction',
    toolbrushusewateredge: 'Toggle Watercolor Edge',
    helponlinehowto: 'How to Use',
    helponlinemanual: 'Instruction Manual',
    helponlinesupport: 'Support',
    helpfaq: 'FAQ',
  };

  const PREFIX = [
    'application', 'file', 'edit', 'layer', 'select', 'view', 'window', 'help',
    'tool', 'filter', 'canvas', 'palette', 'transform', 'page', 'command',
  ];
  const WORDS = [
    'photolibrary', 'recoveryfiles', 'togglespecialrulersnap', 'specialruler',
    'watercolor', 'quick', 'share', 'recovery', 'library', 'clipboard', 'movie',
    'raster', 'vector', 'selection', 'outside', 'inside', 'invert', 'deselect',
    'display', 'preview', 'profile', 'settings', 'resolution', 'size',
    'horizontal', 'vertical', 'rotation', 'rotate', 'transform', 'mesh',
    'bordering', 'management', 'foreground', 'background', 'pressure',
    'density', 'correction', 'revision', 'mixing', 'opacity', 'pixels',
    'alpha', 'brush', 'pencil', 'eraser', 'airbrush', 'bucket', 'gradient',
    'lock', 'merge', 'visible', 'selected', 'layer', 'folder', 'group',
    'canvas', 'palette', 'window', 'screen', 'title', 'menu', 'ruler',
    'grid', 'snap', 'zoom', 'fit', 'reset', 'show', 'hide', 'toggle',
    'export', 'import', 'image', 'file', 'files', 'open', 'close', 'saveas',
    'save', 'new', 'from', 'with', 'and', 'for', 'the', 'all', 'none',
    'clear', 'delete', 'fill', 'undo', 'redo', 'cut', 'copy', 'paste',
    'color', 'colour', 'mode', 'bar', 'tab', 'width', 'height', 'page',
    'document', 'smart', 'object', 'text', 'line', 'shape', 'frame',
  ];
  const WORD_LABEL = {
    photolibrary: 'Photo Library', recoveryfiles: 'Recovery Files',
    togglespecialrulersnap: 'Toggle Special Ruler Snapping', specialruler: 'Special Ruler',
    watercolor: 'Watercolor', saveas: 'Save As', undo: 'Undo', redo: 'Redo',
    color: 'Color', colour: 'Color', alpha: 'Alpha', rgb: 'RGB', cmyk: 'CMYK',
  };
  const SMALL = new Set(['as', 'from', 'of', 'the', 'and', 'for', 'to', 'in', 'on', 'with']);
  const lower = (s) => s.toLowerCase();
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  function tokenize(rest) {
    const out = [];
    let i = 0;
    while (i < rest.length) {
      let found = '';
      for (const w of WORDS) {
        if (rest.startsWith(w, i) && w.length > found.length) found = w;
      }
      if (!found) {
        // Unknown chunk: take up to the next known word, or the rest.
        let next = rest.length;
        for (const w of WORDS) {
          const at = rest.indexOf(w, i + 1);
          if (at > i && at < next) next = at;
        }
        found = rest.slice(i, next);
      }
      out.push(found);
      i += found.length;
    }
    return out;
  }

  /** A human-readable fallback; never the raw lowercase id. */
  function humanizeCommand(id) {
    const raw = String(id || '').trim();
    if (!raw) return 'Unknown command';
    if (EXACT[raw]) return EXACT[raw];
    const prefix = PREFIX.find((p) => raw.startsWith(p) && raw.length > p.length);
    const rest = prefix ? raw.slice(prefix.length) : raw;
    const words = tokenize(rest);
    const labels = words.map((w, i) => {
      const label = WORD_LABEL[w] || w;
      if (/\s/.test(label)) return label;
      // Keep small words lowercase unless they open the name.
      if (SMALL.has(lower(label)) && i > 0) return lower(label);
      return cap(label);
    });
    let name = labels.join(' ').replace(/\s+/g, ' ').trim();
    if (prefix) name = `${cap(prefix)}: ${name}`;
    return name || cap(raw);
  }

  /** Localized CSP label, curated name, or humanized id. */
  function commandName(id, localLabel) {
    const local = String(localLabel || '').trim();
    if (local) return local;
    return humanizeCommand(id);
  }

  return { EXACT, humanizeCommand, commandName };
});
