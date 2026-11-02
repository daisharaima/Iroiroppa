'use strict';

// Main-thread half of the plane worker (kernel/plane-worker.js).
//
// It owns one Worker for the session, runs one job at a time (a plane build is heavy;
// queueing ten of them would only delay the newest), and drops a result whose key no
// longer matches the current request — a drag moves on faster than a build finishes,
// and a stale image painted over a fresh one reads as a jump.
//
// When the worker cannot start (no module worker support, a load error) `available`
// stays false and every caller keeps its synchronous path.

(function installPlaneWorker() {
  const WORKER_URL = 'kernel/plane-worker.js';

  let worker = null;
  let nextId = 1;
  let inflight = null;          // { id, key, resolve }
  let queue = null;             // the single newest job waiting for the worker
  let failed = false;
  let started = 0;
  let completed = 0;
  let totalMs = 0;
  let lastError = '';

  function ensureWorker() {
    if (worker || failed) return worker;
    try {
      worker = new Worker(WORKER_URL);
    } catch {
      failed = true;
      return null;
    }

    worker.onmessage = (event) => {
      const message = event.data || {};
      const current = inflight;
      if (!current || message.id !== current.id) return;
      inflight = null;
      completed += 1;
      if (message.error) {
        current.resolve(null);
      } else {
        totalMs += message.ms || 0;
        current.resolve({ data: message.data, luma: message.luma, ms: message.ms });
      }
      pump();
    };

    worker.onerror = (event) => {
      failed = true;
      lastError = String((event && (event.message || event.filename)) || 'worker error');
      const current = inflight;
      inflight = null;
      queue = null;
      if (current) current.resolve(null);
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
    };

    return worker;
  }

  function pump() {
    if (inflight || !queue || !worker) return;
    const job = queue;
    queue = null;
    inflight = { id: job.id, key: job.key, resolve: job.resolve };
    try {
      worker.postMessage({ id: job.id, spec: job.spec });
    } catch (error) {
      inflight = null;
      job.resolve(null);
    }
  }

  /**
   * Ask for a plane. Resolves with `{ data, luma, ms }`, or `null` when the worker is
   * unavailable or dropped the job. `key` is echoed back so the caller can detect a
   * stale reply.
   */
  function render(spec, key) {
    if (failed || !ensureWorker()) return Promise.resolve(null);
    return new Promise((resolve) => {
      // Newest wins: a build for an older frame is worthless once the colour moved.
      if (queue) queue.resolve(null);
      started += 1;
      queue = { id: nextId++, key, spec, resolve };
      pump();
    });
  }

  function stop() {
    if (!worker) return;
    try { worker.terminate(); } catch { /* already gone */ }
    worker = null;
    inflight = null;
    queue = null;
  }

  const api = {
    available: () => !failed,
    render,
    stop,
    /** One pending + one running at most; used by the tests and the debug line. */
    pressure: () => (inflight ? 1 : 0) + (queue ? 1 : 0),
    stats: () => ({ started, completed, totalMs: Math.round(totalMs), failed, error: lastError }),
  };

  window.IroPlaneWorker = api;
})();
