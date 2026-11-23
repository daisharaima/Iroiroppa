'use strict';

(function installPerfGaps() {
  const bridge = window.csp;
  if (!bridge || !bridge.perfGaps || !bridge.perfGapsReport) return;

  const MAX_SAMPLES = 4000;
  let sampling = false;
  let samples = [];
  let last = 0;
  let frame = 0;

  let longTasks = [];

  if (typeof PerformanceObserver === 'function') {
    try {
      new PerformanceObserver((list) => {
        if (!sampling) return;
        for (const entry of list.getEntries()) {
          longTasks.push({
            at: Math.round(entry.startTime - gestureStart),
            ms: Math.round(entry.duration * 10) / 10,
          });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {  }
  }
  let gestureStart = 0;
  let workerAtStart = null;

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
    longTasks = [];
    gestureStart = performance.now();
    workerAtStart = window.IroPlaneWorker && window.IroPlaneWorker.stats ? window.IroPlaneWorker.stats() : null;
    last = 0;
    requestAnimationFrame(tick);
    window.__perfGesture = label || 'gesture';
  }

  function end(extra = {}) {
    if (!sampling) return null;
    sampling = false;
    if (frame) cancelAnimationFrame(frame);
    const sorted = samples.slice().sort((a, b) => a - b);

    const enough = samples.length >= 30;
    const summary = {
      gesture: window.__perfGesture || 'gesture',
      n: samples.length,
      percentiles: enough ? 'ok' : 'withheld (n<30)',
      frames: samples.length,
      spanMs: Math.round(samples.reduce((sum, value) => sum + value, 0)),
      p50: enough ? Math.round(percentile(sorted, 0.5) * 100) / 100 : null,
      p95: enough ? Math.round(percentile(sorted, 0.95) * 100) / 100 : null,
      p99: enough ? Math.round(percentile(sorted, 0.99) * 100) / 100 : null,
      max: Math.round((sorted[sorted.length - 1] || 0) * 100) / 100,
      over25: samples.filter((value) => value > 25).length,
      over50: samples.filter((value) => value > 50).length,
      longTasks: longTasks.length,
      longestTask: longTasks.reduce((max, task) => Math.max(max, task.ms), 0),
      blockingMs: Math.round(longTasks.reduce((sum, task) => sum + Math.max(0, task.ms - 50), 0)),
      worst: longTasks.slice().sort((a, b) => b.ms - a.ms).slice(0, 3),
      planeDbg: window.__planeDbg || null,
      plotDbg: window.__plotDbg || null,
      planeWorker: window.IroPlaneWorker && window.IroPlaneWorker.stats
        ? (() => { const now = window.IroPlaneWorker.stats(); const start = workerAtStart || { started: 0, completed: 0, totalMs: 0 }; return { jobs: now.started - start.started, done: now.completed - start.completed, ms: now.totalMs - start.totalMs, failed: now.failed, error: now.error || '' }; })()
        : null,
      ...extra,
    };
    samples = [];
    longTasks = [];
    last = 0;
    bridge.perfGapsReport(summary);
    return summary;
  }

  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    begin(event.target && event.target.id ? event.target.id : 'palette');
  }, true);

  window.addEventListener('pointerup', () => end(), true);
  window.addEventListener('pointercancel', () => end({ cancelled: true }), true);

  window.Iro = window.Iro || {};
  window.Iro.perfGaps = { begin, end, sampling: () => sampling };
})();
