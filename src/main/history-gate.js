'use strict';

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
