'use strict';

// The drawing-only gate, in one place and enforced by main (docs/INVARIANTS.md).
//
// Gate OFF: a host pick goes through the normal pointer-up/fallback-settle path.
// Gate ON: a pick (CSP or Iroiroppa) is only *noted*; the next canvas contact
// records the colour that is actually used. No renderer keeps gate state or may
// add host colours, so a second palette/float cannot leak past the gate.
//
// Pure and injected, so the routing is unit-tested without Electron.

/**
 * @param {object} opts
 * @param {() => boolean} opts.isOn
 * @param {object} opts.recorder the history recorder (`note`/`observe`/`commit`/`cancel`)
 * @param {() => ({r:number,g:number,b:number}|null)} [opts.currentRgb]
 * @param {() => void} [opts.resync] re-broadcast the authoritative history
 */
function createHistoryGate({ isOn, recorder, currentRgb = () => null, resync = () => {} }) {
  return {
    isOn,
    /** A host colour change. Gate ON keeps it pending for the next canvas contact. */
    onPick(rgb) {
      if (isOn()) recorder.note(rgb);
      else recorder.observe(rgb);
    },
    /** A window's explicit pick (history:add). Never records while the gate is on. */
    onExplicit(rgb) {
      if (isOn()) {
        recorder.note(rgb);
        // A window whose gate state is stale may have unshifted a local tile; the
        // authoritative list clears it. This is the old multi-palette leak's fix.
        resync();
        return false;
      }
      recorder.commit(rgb);
      return true;
    },
    /** The gate-OFF release path; skipped entirely while the gate is on. */
    onUp(commitUp) {
      if (!isOn()) commitUp();
    },
    /** Settings changed: cancel anything in flight and seed the pending colour. */
    onToggle() {
      recorder.cancel();
      if (!isOn()) return;
      const rgb = currentRgb();
      if (rgb) recorder.note(rgb);
    },
  };
}

module.exports = { createHistoryGate };
