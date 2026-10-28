'use strict';

// ColorStore: the picker's single source of truth. Owns the OKLCH value, the
// CSP slots/transparency, the proof transform and the gamut routing. Modules
// read it and request changes; the chrome (banner, mode bar, footer) does the
// same. Nothing else keeps colour state.

(function () {
  const Color = window.Color;

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const clamp255 = (x) => clamp(Math.round(x), 0, 255);
  const clamp01 = (x) => clamp(x, 0, 1);

  const TRANSPARENT_CSS = 'repeating-conic-gradient(#d9dde7 0 25%, #ffffff 0 50%) 50% / 8px 8px';
  const HISTORY_MAX = 100;
  // A sibling preview stream is treated as one gesture: modules render it like a
  // local drag, then do one full-quality pass when the stream has been quiet for
  // this long (src/renderer/kernel/color-store.js, `interactive`).
  const PREVIEW_IDLE_MS = 140;

  class ColorStore {
    constructor({ csp }) {
      this.csp = csp;
      // Canonical appearance: OKLab (D65), rectangular and unbounded. `hue` is the
      // polar anchor kept beside it so an achromatic colour remembers its hue —
      // exactly what the old stored `H` gave (docs/COLOR.md).
      this.L = 0.82;
      const ab = Color.oklchToOklab(0.82, 0.12, 217.2);
      this.a = ab.a;
      this.b = ab.b;
      this.hue = 217.2;
      this.transparent = false;
      this.slots = { main: null, sub: null, active: null };
      this.mode = 'default';
      this.proof = null;
      this.proofInfo = null;
      this.lastStored = null;
      // The records this window wrote lately: a broadcast echo of our own write
      // (and CSP's read-back of it) must not move the pick — the record is 8-bit
      // and, past the gamut, already clipped (docs/COLOR.md).
      this._ownWrites = [];
      this.pendingSend = false;
      this._previewLab = null;
      this._previewFrame = 0;
      // A sibling palette's preview stream is a display-only gesture: modules render
      // it like a local drag (overlays every frame, one raster per frame) instead of
      // rebuilding every map on every message (src/renderer/kernel/color-store.js).
      this._inPreviewUntil = 0;
      this._inPreviewEmit = 0;
      this._inPreviewTimer = null;
      // Flags the rest of the app keeps in sync.
      this.connected = false;
      this.dragging = false;
      this.liveSync = true;
      this.viewFamily = 'all';
      this.history = []; // recently stored colours, newest first
      // Main enforces the drawing-only gate; the store skips its optimistic add
      // while the gate is on and only mirrors the shared list.
      this.historyGate = false;
      // Paint colours the sRGB display cannot show as the nearest displayable colour
      // (false) or dim them so the out-of-display region is visible (true).
      this.markOutOfDisplay = false;
      this._subs = new Set();
    }

    /** Chroma — derived from the canonical OKLab value. */
    get C() { return Math.hypot(this.a, this.b); }

    /** Hue anchor — the last meaningful hue (docs/COLOR.md). */
    get H() { return this.hue; }

    /**
     * A colour gesture is in flight: a local drag, or a sibling palette streaming a
     * live preview. Modules use this for render *cadence* only; `dragging` keeps its
     * write/echo meaning (a preview must never suppress incoming colours).
     */
    get interactive() {
      return this.dragging || (this._inPreviewUntil > 0 && Date.now() < this._inPreviewUntil);
    }

    /** The canonical value every module shares. */
    lab() { return { L: this.L, a: this.a, b: this.b }; }

    /**
     * Set the canonical value from OKLab (used by the model adapters).
     *
     * `opts.hue` names the hue the caller knows the coarse value carries even when
     * it is grey (the Wheel's ring): without it a grey keeps the previous anchor and
     * the ring cannot be turned. It is an OKLCH hue angle, like the anchor itself.
     */
    setLab(lab, opts) {
      const lch = Color.oklabToOklch(lab.L, lab.a, lab.b);
      // A rectangular value carries no hue for a grey: keep the anchor there. The
      // threshold matches the slices (1e-6): an RGB grey arrives with C ≈ 2e-8, so
      // a 1e-9 gate never engaged and the hue read ~90° instead of the anchor.
      const named = opts && opts.hue != null;
      const H = named ? opts.hue : (lch.C > 1e-6 ? lch.H : this.hue);
      this.setLCH({ L: lab.L, C: lch.C, H }, opts);
    }

    // --- observation ------------------------------------------------------

    subscribe(fn) {
      this._subs.add(fn);
      return () => this._subs.delete(fn);
    }

    _emit() {
      for (const fn of this._subs) {
        try { fn(this); } catch (err) { console.error('[store] subscriber failed', err); }
      }
    }

    lch() {
      return { L: this.L, C: this.C, H: this.H };
    }

    /** Tell subscribers to redraw (used after direct field changes). */
    notify() {
      this._emit();
    }

    setViewFamily(value) {
      const next = window.IroColorModels
        ? window.IroColorModels.normalizeFamily(value)
        : (value || 'all');
      if (next === this.viewFamily) return;
      this.viewFamily = next;
      this._emit();
    }

    // --- proof / gamut ----------------------------------------------------

    /** The active proof, and the model reference it implies. */
    get proof() { return this._proof || null; }

    set proof(next) {
      this._proof = next || null;
      // OKHSV/OKHSL/OKHWB are shaped by an RGB cube: hand them the document's cube
      // (matrix/TRC profile) so every colour the document holds is reachable, or keep
      // Ottosson's sRGB reference when there is no RGB profile.
      const Models = window.IroColorModels;
      const Ref = window.IroModelReference;
      const reference = Ref ? Ref.create(this._proof) : null;
      this._referenceKey = Ref ? Ref.keyOf(reference) : 'srgb';
      if (Models && typeof Models.setReference === 'function') Models.setReference(reference);
    }

    proofOn() {
      return this.mode !== 'default' && Boolean(this.proof);
    }

    useWorkingGamut() {
      return this.proofOn() && this.proof.model === 'working';
    }

    plotKeyTag() {
      const scope = this.useWorkingGamut() ? `w:${(this.proofInfo && this.proofInfo.path) || ''}` : 's';
      // The RGB-referenced models are built on the document's cube, so their axes depend
      // on the profile even when the picker is *not* in working-gamut mode: a map drawn
      // under one profile must not be reused under another.
      return `${scope}:${this._referenceKey || 'srgb'}`;
    }

    modelLimited(model) {
      // True while the RGB-referenced spaces can only name sRGB colours (the notice).
      // With proofing off the working gamut *is* sRGB, so there is nothing to warn about.
      if (!this.proofOn()) return false;
      return window.IroColorModels
        ? window.IroColorModels.referenceLimited(model)
        : false;
    }

    inGamut(L, C, H) {
      return this.useWorkingGamut() ? this.proof.inGamut({ L, C, H }) : Color.inGamut(L, C, H);
    }

    maxChroma(L, H) {
      return this.useWorkingGamut() ? this.proof.maxChroma(L, H, 0.6) : Color.maxChroma(L, H);
    }

    /** The *document's* gamut regardless of the display model: the region a picker
     *  must paint as pickable (the disc uses this, not the recorded gamut). */
    inDocumentGamut(L, C, H) {
      return this.proofOn() && this.proof ? this.proof.inGamut({ L, C, H }) : Color.inGamut(L, C, H);
    }

    /** The *document's* gamut regardless of the proof-mode switch (the wheel's ring
     *  shows what the document can hold, which must not depend on the display mode). */
    documentMaxChroma(L, H) {
      return this.proofOn() && this.proof ? this.proof.maxChroma(L, H, 0.6) : Color.maxChroma(L, H);
    }

    /** In-gamut chroma intervals for the map silhouette (see Color). */
    chromaIntervals(L, H) {
      return this.useWorkingGamut() ? this.proof.chromaIntervals(L, H, 0.6) : Color.chromaIntervals(L, H);
    }

    /** Largest in-gamut chroma <= C: what an out-of-gamut value snaps to. */
    reduceChroma(L, C, H) {
      return this.useWorkingGamut() ? this.proof.reduceChroma(L, C, H, 0.6) : Color.reduceChroma(L, C, H);
    }

    cmax() {
      return this.useWorkingGamut() ? this.proof.chromaAxis() : 0.4;
    }

    /** OKLCH of a value recorded by CSP, as seen through the current proof. */
    readRecorded(rgb) {
      const f = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
      return this.proofOn() ? this.proof.readOklch(f) : Color.rgbToOklch(f[0], f[1], f[2]);
    }

    /** The value to store in CSP for the current OKLCH (or a given one). */
    contentRgb(lch = null) {
      let f;
      if (this.proofOn()) {
        f = this.proof.writeSrgb(lch || this.lch());
      } else if (lch) {
        const ab = Color.oklchToOklab(lch.L, lch.C, lch.H);
        const c = Color.oklabToRgb(lch.L, ab.a, ab.b);
        f = [c.r, c.g, c.b];
      } else {
        const c = Color.oklabToRgb(this.L, this.a, this.b);
        f = [c.r, c.g, c.b];
      }
      return { r: clamp255(f[0] * 255), g: clamp255(f[1] * 255), b: clamp255(f[2] * 255) };
    }

    /** The colour as it appears on screen. */
    appearanceRgb(lch = null) {
      const c = lch
        ? Color.oklchToRgb(lch.L, lch.C, lch.H)
        : Color.oklabToRgb(this.L, this.a, this.b);
      return { r: clamp255(c.r * 255), g: clamp255(c.g * 255), b: clamp255(c.b * 255) };
    }

    /** How a value recorded by CSP appears (for history chips). */
    appearanceFromRecorded(rgb) {
      if (!rgb) return null;
      const f = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
      const out = this.proofOn() ? this.proof.displaySrgbFromContent(f) : f;
      return { r: clamp255(out[0] * 255), g: clamp255(out[1] * 255), b: clamp255(out[2] * 255) };
    }

    /** Add an explicit pick to the shared history (newest first, de-duplicated).
     *  Host picks are recorded by main; this path is Iroiroppa's own commit. */
    _recordHistory(rgb) {
      if (!rgb) return false;
      if (this.historyGate) {
        // The drawing-only gate: tell main about the explicit pick (it becomes
        // pending) but add nothing locally; a canvas contact adds it later.
        if (this.csp && this.csp.pushHistory) {
          try { this.csp.pushHistory({ r: rgb.r, g: rgb.g, b: rgb.b }); } catch { /* ignore */ }
        }
        return false;
      }
      const last = this.history[0];
      if (last && last.r === rgb.r && last.g === rgb.g && last.b === rgb.b) return false;
      this.history.unshift({ r: rgb.r, g: rgb.g, b: rgb.b });
      if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
      // Main keeps the shared list, so a board floated into its own window (and
      // the palette) always show the same history.
      if (this.csp && this.csp.pushHistory) {
        try { this.csp.pushHistory({ r: rgb.r, g: rgb.g, b: rgb.b }); } catch { /* ignore */ }
      }
      return true;
    }

    /** Adopt the shared history (main is the source of truth). */
    setHistory(list) {
      const next = [];
      if (Array.isArray(list)) {
        for (const c of list.slice(0, HISTORY_MAX)) {
          if (Number.isFinite(c && c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)) {
            next.push({ r: c.r, g: c.g, b: c.b });
          }
        }
      }
      const before = JSON.stringify(this.history);
      if (JSON.stringify(next) === before) return;
      this.history = next;
      this._emit();
    }

    contentHex(lch = null) {
      const s = this.contentRgb(lch);
      return Color.rgbToHex(s.r, s.g, s.b);
    }

    // --- changes ----------------------------------------------------------

    /**
     * Adopt an OKLCH value. Chroma is clamped to the axis, but may sit *outside*
     * the gamut — the C slider uses that to explore past the silhouette. When
     * `snap` is set, an out-of-gamut chroma is pulled back to the boundary at
     * this lightness and hue (slice drags, and values recorded by CSP).
     */
    _applyLCH(lch, { snap = false } = {}) {
      const L = clamp01(lch.L);
      const H = clamp(lch.H, 0, 360);
      let C = clamp(lch.C, 0, this.cmax());
      if (snap && !this.inGamut(L, C, H)) {
        C = clamp(this.reduceChroma(L, C, H), 0, this.cmax());
      }
      const ab = Color.oklchToOklab(L, C, H);
      this.L = L;
      this.a = ab.a;
      this.b = ab.b;
      this.hue = H;
    }

    /** Set the colour and optionally push it to CSP. */
    setLCH(lch, { notify = 'none', snap = false } = {}) {
      this._applyLCH(lch, { snap });
      let stored = null;
      if (notify !== 'none') {
        stored = this.contentRgb();
        this.lastStored = stored;
        this._markActiveSlot(stored);
        // An explicit settled pick records immediately; main records host picks
        // and broadcasts the shared list to every window.
        if (notify === 'commit') this._recordHistory(stored);
      }
      if (stored) this._rememberWrite(stored);
      this._emit();
      if (notify === 'live') this._write(false);
      else if (notify === 'commit') this._write(true);
    }

    /** Remember a record this window wrote, newest last, so an echo cannot move us. */
    _rememberWrite(rgb) {
      this._ownWrites.push({ r: rgb.r, g: rgb.g, b: rgb.b });
      if (this._ownWrites.length > 8) this._ownWrites.shift();
    }

    /** Is this RGB one of our own recent writes (a broadcast echo or a read-back)? */
    _isOwnWrite(rgb) {
      return this._ownWrites.some((w) => w.r === rgb.r && w.g === rgb.g && w.b === rgb.b);
    }

    /** Interpret a recorded sRGB value (hex field, paste) without sending. */
    applyRecordedRgb(rgb) {
      const { L, C, H } = this.readRecorded(rgb);
      // A recorded value is in gamut by definition: snap for safety.
      this._applyLCH({ L, C, H }, { snap: true });
    }

    /** Push the current colour to CSP now (used after applyRecordedRgb). */
    push(immediate) {
      this.lastStored = this.contentRgb();
      this._rememberWrite(this.lastStored);
      this._recordHistory(this.lastStored);
      this._markActiveSlot(this.lastStored);
      this._emit();
      this._write(immediate);
    }

    /** A colour coming from CSP. Ignored mid-drag so a lagging echo cannot pull
     *  the local OKLab value out from under the picker; the service's grace
     *  window (src/main/service.js) covers the not-dragging case. Main records
     *  host picks, so this only applies the colour and never writes history. */
    applyIncoming(color) {
      if (!color || this.dragging) return;
      if (typeof color.transparent === 'boolean') this.transparent = color.transparent;
      if (color.main || color.sub || color.active) {
        this.slots = { main: color.main || null, sub: color.sub || null, active: color.active || null };
      }
      if (color.rgb && this._isOwnWrite(color.rgb)) {
        // Our own write coming back: the store already holds the picked colour,
        // and re-deriving it from the 8-bit record would rotate the hue (up to a
        // few degrees at low chroma) or adopt a clipped record. Keep the pick.
        this.lastStored = { r: color.rgb.r, g: color.rgb.g, b: color.rgb.b };
        this._emit();
        return;
      }
      if (color.rgb) {
        this._ownWrites.length = 0; // a real host change ends our burst
        this.lastStored = { r: color.rgb.r, g: color.rgb.g, b: color.rgb.b };
        const { L, C, H } = this.readRecorded(color.rgb);
        this._applyLCH({ L, C, H }, { snap: true });
      }
      this._emit();
    }

    /** Re-read the stored colour through the current proof (profile/mode change). */
    reinterpret() {
      if (this.lastStored) {
        const { L, C, H } = this.readRecorded(this.lastStored);
        this._applyLCH({ L, C, H }, { snap: true });
      }
      this._emit();
    }

    selectSlot(slot) {
      return this.csp.selectSlot(slot);
    }

    /** Reflect the current colour on the active slot chip. */
    _markActiveSlot(stored) {
      this.transparent = false;
      if (!this.slots.active || this.slots.active === 'transparent') this.slots.active = 'main';
      const active = this.slots.active;
      this.slots = {
        ...this.slots,
        [active]: { ...(this.slots[active] || {}), rgb: stored },
      };
    }

    /** Remember a pick made while disconnected, so it can be flushed later. */
    _write(immediate) {
      if (immediate) this._cancelPreview();
      else this._queuePreview();
      if (!this.connected) {
        this.pendingSend = true;
        return;
      }
      if (!immediate && !this.liveSync) return;
      this.csp.writeColor(this.lastStored, immediate);
    }

    _cancelPreview() {
      if (!this._previewFrame) return;
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._previewFrame);
      else clearTimeout(this._previewFrame);
      this._previewFrame = 0;
      this._previewLab = null;
    }

    /**
     * A display-only preview for sibling palettes. It carries exact OKLab, so a
     * peer does not re-derive the value from the 8-bit CSP record (that rotates
     * the hue at low chroma). One frame per animation; it never writes or
     * records history.
     */
    _queuePreview() {
      if (!this.csp || typeof this.csp.previewColor !== 'function') return;
      this._previewLab = this.lab();
      if (this._previewFrame) return;
      const fire = () => {
        this._previewFrame = 0;
        const lab = this._previewLab;
        this._previewLab = null;
        if (!lab) return;
        this.csp.previewColor(lab, this.slots.active);
      };
      this._previewFrame = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(fire)
        : setTimeout(fire, 16);
    }

    /** Apply a sibling palette's exact-OKLab preview without writing or recording. */
    applyPreview(color) {
      if (!color || !color.lab || this.dragging) return;
      const lab = color.lab;
      if (![lab.L, lab.a, lab.b].every(Number.isFinite)) return;
      this.L = clamp01(lab.L);
      this.a = lab.a;
      this.b = lab.b;
      if (typeof color.active === 'string') this.slots.active = color.active;
      const lch = Color.oklabToOklch(this.L, this.a, this.b);
      if (lch.C > 1e-6) this.hue = lch.H;
      this.lastStored = this.contentRgb();
      this._markActiveSlot(this.lastStored);
      // Mark the stream: the whole window renders like a gesture for the next few
      // frames, and one trailing emit gives every module its full-quality rebuild.
      this._inPreviewUntil = Date.now() + PREVIEW_IDLE_MS;
      if (!this._inPreviewEmit) {
        const fire = () => { this._inPreviewEmit = 0; this._emit(); };
        this._inPreviewEmit = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(fire)
          : setTimeout(fire, 16);
      }
      if (this._inPreviewTimer) clearTimeout(this._inPreviewTimer);
      this._inPreviewTimer = setTimeout(() => {
        this._inPreviewTimer = null;
        this._inPreviewUntil = 0;
        this._emit();
      }, PREVIEW_IDLE_MS + 60);
      if (this._inPreviewTimer && this._inPreviewTimer.unref) this._inPreviewTimer.unref();
    }

    flushPending() {
      if (!this.pendingSend) return;
      this.pendingSend = false;
      this.push(true);
    }
  }

  window.Iro = window.Iro || {};
  window.Iro.ColorStore = ColorStore;
  window.Iro.TRANSPARENT_CSS = TRANSPARENT_CSS;
  window.Iro.clamp255 = clamp255;
})();
