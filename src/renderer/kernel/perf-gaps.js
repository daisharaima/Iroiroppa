'use strict';

// Frame-gap recorder for a gesture (docs/PERF.md, `--perf-gaps`).
//
// It answers one question the other tools cannot: while the user drags a control,
// does the palette keep painting every frame, or does a heavy panel block the main
// thread? A gap above the refresh interval is a visible stutter; a run of them is a
// stall.
//
// The recorder is passive: it samples `requestAnimationFrame` timestamps, keeps the
// deltas of the current gesture, and on release reports the distribution to main,
// which appends one line to `perf-trace.log`. Nothing is drawn or changed.

(function installPerfGaps() {
  const bridge = window.csp;
  if (!bridge || !bridge.perfGaps || !bridge.perfGapsReport) return;

  const MAX_SAMPLES = 4000;
  let sampling = false;
  let samples = [];
  let last = 0;
  let frame = 0;

  function tick(now) {
    if (!sampling) return;
    if (last) {
      samples.push(now - last);
      if (samples.length > MAX_SAMPLES) samples.shift();
    }
    last = now;
    frame = requestAnimationFrame(tick);
    return frame;
  }

  function percentile(sorted, fraction) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(sorted.length * fraction) - 1));
    return sorted[index];
  }

  function begin(label) {
    if (sampling) return;
    sampling = true;
    samples = [];
    last = 0;
    requestAnimationFrame(tick);
    window.__perfGesture = label || 'gesture';
  }

  function end(extra = {}) {
    if (!sampling) return null;
    sampling = false;
    if (frame) cancelAnimationFrame(frame);
    const sorted = samples.slice().sort((a, b) => a - b);
    const summary = {
      gesture: window.__perfGesture || 'gesture',
      frames: samples.length,
      spanMs: Math.round(samples.reduce((sum, value) => sum + value, 0)),
      p50: Math.round(percentile(sorted, 0.5) * 100) / 100,
      p95: Math.round(percentile(sorted, 0.95) * 100) / 100,
      p99: Math.round(percentile(sorted, 0.99) * 100) / 100,
      max: Math.round((sorted[sorted.length - 1] || 0) * 100) / 100,
      over25: samples.filter((value) => value > 25).length,
      over50: samples.filter((value) => value > 50).length,
      ...extra,
    };
    samples = [];
    last = 0;
    bridge.perfGapsReport(summary);
    return summary;
  }

  // A gesture is a press on the palette's own surface: that is where a drag sends a
  // colour write per move and where a heavy panel would stall the paint.
  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    begin(event.target && event.target.id ? event.target.id : 'palette');
  }, true);

  window.addEventListener('pointerup', () => end(), true);
  window.addEventListener('pointercancel', () => end({ cancelled: true }), true);

  window.Iro = window.Iro || {};
  window.Iro.perfGaps = { begin, end, sampling: () => sampling };
})();
