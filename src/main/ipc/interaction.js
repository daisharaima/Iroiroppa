'use strict';

// The interaction IPC group (E1, colour only; docs/STATE.md "local-first").
//
// Registered only when `--local-first` is on, so a normal run has exactly the
// channels it had before. The sender is resolved from the event, never from the
// payload: a window can only drive its own interaction.
//
// An update is forwarded to the service as a coalesced write because that is
// what the colour loop already does per pointermove; the hub adds the ordering,
// the ownership and the reject path around it.

const { BrowserWindow, ipcMain } = require('electron');
const { sendTo } = require('../broadcast');

function register(ctx, trusted) {
  if (!ctx.localFirst) return;

  function rejectOwner(interaction) {
    if (!interaction) return;
    const win = BrowserWindow.fromId(interaction.windowId);
    if (win && !win.isDestroyed()) {
      sendTo(win, 'interaction:reject', { interactionId: interaction.interactionId, reason: interaction.reason });
    }
    if (ctx.traceInteraction) console.log(`[interaction] reject ${interaction.interactionId} -> win ${interaction.windowId} (${interaction.reason})`);
  }

  // `--trace-interaction` prints one line per protocol event, so a live run can be
  // checked from the log (one begin, N updates, one end, zero rejects).
  const trace = (line) => { if (ctx.traceInteraction) console.log(`[interaction] ${line}`); };

  ipcMain.handle('interaction:begin', (event, spec = {}) => {
    if (!trusted(event)) return { ok: false, reason: 'untrusted' };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, reason: 'no-window' };
    const id = typeof spec.id === 'string' ? spec.id : '';
    const domain = spec.domain === 'color' ? 'color' : '';
    if (!id || !domain) return { ok: false, reason: 'bad-args' };
    const cur = ctx.stateHub ? ctx.stateHub.get(domain) : null;
    const r = ctx.interactions.begin({
      id,
      domain,
      windowId: win.id,
      baseRev: spec.baseRev,
      currentRev: cur ? cur.rev : 0,
    });
    rejectOwner(r.rejected);
    trace(`begin ${id} win=${win.id} ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
    return { ok: r.ok, reason: r.reason || null };
  });

  ipcMain.on('interaction:update', (event, spec = {}) => {
    if (!trusted(event)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    const cur = ctx.interactions.get('color');
    if (!win || !cur || cur.windowId !== win.id) return;
    const r = ctx.interactions.update({ id: spec.id, domain: 'color', seq: spec.seq, value: spec.value });
    if (!r.ok) return;
    trace(`update ${spec.id} seq=${r.seq}`);
    if (spec.value && ctx.service) ctx.service.writeColor(spec.value, { immediate: false });
  });

  ipcMain.handle('interaction:end', (event, spec = {}) => {
    if (!trusted(event)) return { ok: false, reason: 'untrusted' };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, reason: 'no-window' };
    const r = ctx.interactions.end({
      id: spec.id,
      domain: 'color',
      seq: spec.seq,
      value: spec.value,
      reason: spec.reason === 'cancel' ? 'cancel' : 'commit',
    });
    if (r.ok && r.commit && r.value && ctx.service) ctx.service.writeColor(r.value, { immediate: true });
    trace(`end ${spec.id} ok=${r.ok} commit=${Boolean(r.commit)}`);
    return { ok: r.ok, reason: r.reason || null };
  });
}

module.exports = { register };
