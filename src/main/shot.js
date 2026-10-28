'use strict';

// The --shot driver: the scripted UI-verification flags (see docs/DEV.md). It is
// only ever run with --shot, and takes the app context so it can reach the live
// windows (settings/floats/overlay) rather than a startup snapshot.

const fs = require('node:fs');
const { app } = require('electron');
const { sendTo } = require('./broadcast');

function runShot(ctx) {
  const { popup, shotPath, argValue, floatWins, floatWinFor } = ctx;
  const { readModuleSettings, writeModuleSettings } = ctx;
  // A float can close mid-eval (Dock, drops elsewhere); never let a pending
  // executeJavaScript hang the whole driver.
  const evalWin = (win, js) => Promise.race([
    win.webContents.executeJavaScript(js).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  popup.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const proofModel = argValue('--proof-model');
        if (proofModel) {
          await popup.webContents.executeJavaScript(`window.csp.updateSettings({ proofModel: ${JSON.stringify(proofModel)} })`);
          await new Promise((r) => setTimeout(r, 350));
        }
        const uiScale = argValue('--ui-scale');
        if (uiScale) {
          await popup.webContents.executeJavaScript(`window.csp.updateSettings({ uiScale: ${Number(uiScale)} })`);
          await new Promise((r) => setTimeout(r, 400));
        }
        const themeArg = argValue('--theme');
        if (themeArg) {
          await popup.webContents.executeJavaScript(`window.csp.updateSettings({ theme: ${JSON.stringify(themeArg)} })`);
          await new Promise((r) => setTimeout(r, 400));
        }
        const mode = argValue('--mode');
        if (mode) {
          await popup.webContents.executeJavaScript(`window.csp.updateSettings({ proofMode: ${JSON.stringify(mode)} })`);
          await new Promise((r) => setTimeout(r, 500));
        }
        if (process.argv.includes('--profiles')) {
          // The picker is drawn by the overlay now (it has to leave the palette's bounds),
          // so click the Session module's proof button and then a row in the overlay.
          await popup.webContents.executeJavaScript(`document.querySelector('.session-proof')?.click()`);
          await new Promise((r) => setTimeout(r, 700));
          const rowArg = argValue('--profile-row');
          if (rowArg !== undefined) {
            const ow = ctx.overlayWin;
            if (ow && !ow.isDestroyed() && ow.isVisible()) {
              await ow.webContents.executeJavaScript(
                `document.querySelectorAll('.overlay-menu-item')[${Number(rowArg)}]?.click()`,
              );
            }
            await new Promise((r) => setTimeout(r, 900));
          }
          const ow = ctx.overlayWin;
          if (ow && !ow.isDestroyed() && ow.isVisible()) {
            const menuText = await ow.webContents.executeJavaScript(
              `JSON.stringify([...document.querySelectorAll('.overlay-menu-item')].map((n) => n.textContent))`,
            );
            console.log('profiles:', JSON.stringify({
              overlayBounds: ow.getBounds(),
              paletteBounds: popup.getBounds(),
              items: JSON.parse(menuText),
            }));
            const menuShot = argValue('--menu-shot');
            if (menuShot) {
              const img = await ow.webContents.capturePage();
              fs.writeFileSync(menuShot, img.toPNG());
              console.log(`menu screenshot written to ${menuShot}`);
            }
          } else {
            console.log('profiles: the overlay never appeared');
          }
        }
        const posArg = argValue('--pos');
        if (posArg) {
          // --pos <x>,<y> places the palette (so float tests are on screen).
          // Placement saving is deliberately muted while the palette is parked for
          // a scan and for ~600 ms after it is restored, so a placement test needs
          // auto-connect off — otherwise the move is (correctly) not recorded.
          const [px, py] = String(posArg).split(',').map(Number);
          if (Number.isFinite(px) && Number.isFinite(py)) popup.setPosition(Math.round(px), Math.round(py));
          await new Promise((r) => setTimeout(r, 300));
        }
        const resizeArg = argValue('--resize-window');
        if (resizeArg) {
          // --resize-window WxH: resize the palette the way the OS does (not through the
          // board), so the board's own user-drag handling is exercised.
          const [rw, rh] = String(resizeArg).split('x').map(Number);
          if (Number.isFinite(rw) && Number.isFinite(rh)) {
            popup.setContentSize(Math.round(rw), Math.round(rh));
            await new Promise((r) => setTimeout(r, 900));
          }
        }
        const resolveAt = argValue('--resolve-drop');
        if (resolveAt) {
          // What the drop resolver would do at a screen point, against the live
          // panes — the resolver, the pane list and the window placement together,
          // without touching the drag flows (docs/LAYOUT.md, V4).
          const [rx, ry] = String(resolveAt).split(',').map(Number);
          if (Number.isFinite(rx) && Number.isFinite(ry)) {
            const Drop = require('../shared/drop-resolve');
            const panes = ctx.paneList();
            const plan = Drop.resolveDrop({ point: { x: rx, y: ry }, panes });
            console.log('drop plan:', JSON.stringify({ at: [rx, ry], panes: panes.map((p) => [p.paletteId, p.boxes ? 'drawn' : 'model']), plan, target: Drop.toPlaceTarget(plan) }));
          }
        }
        const sessionDrag = argValue('--session-drag');
        if (sessionDrag) {
          // Drive the drag session with no mouse: place the debug cursor, begin,
          // tick, drop, and report the plan, the intent and what the document
          // became (docs/LAYOUT.md, V4).
          const [instanceId, sx, sy] = String(sessionDrag).split(',');
          const before = JSON.stringify(ctx.readLayoutDoc().columns.map((c) => (c.modules || []).map((m) => m.instanceId)));
          ctx.setDebugCursor({ x: Number(sx), y: Number(sy) });
          const started = ctx.dragSession.begin({ items: [instanceId], text: instanceId });
          ctx.dragSession.update();
          const out = ctx.dragSession.drop();
          ctx.setDebugCursor(null);
          const after = JSON.stringify(ctx.readLayoutDoc().columns.map((c) => (c.modules || []).map((m) => m.instanceId)));
          console.log('session drag:', JSON.stringify({ started, plan: out.plan, target: out.target, ok: out.ok, changed: before !== after }));
          console.log('session drag columns:', after);
          await new Promise((r) => setTimeout(r, 400));
        }
        // A drop at a screen point, through the drag session — the same path a real
        // pointer drag takes (docs/LAYOUT.md, V4/V6). The old flags called
        // `_dropExternal` on the source board, which is the handshake being deleted.
        const dropAtPoint = (instanceId, at) => {
          // Which window this module lives in now: a real drag always knows it, and the
          // resolver sorts that window last. Without it the flags test a different
          // resolver than the app runs.
          const sourceOf = (id) => {
            const doc = ctx.readLayoutDoc();
            for (const col of doc.columns || []) {
              for (const m of col.modules || []) if (m.instanceId === id) return ctx.primaryPaletteId();
            }
            for (const f of doc.floats || []) {
              for (const col of f.columns || []) {
                for (const m of col.modules || []) if (m.instanceId === id) return f.floatId;
              }
            }
            return null;
          };
          ctx.setDebugCursor({ x: Math.round(at.x), y: Math.round(at.y) });
          // The drawn size of what is being dragged: a real drag sends it (the kernel measures the
          // card) and main's size rule needs it, so the flags must send it too or the growth they
          // report is not the growth the app produces.
          const box = ctx.drawnBoxFor(instanceId);
          ctx.dragSession.begin({
            items: [instanceId],
            text: instanceId,
            sourcePaletteId: sourceOf(instanceId),
            width: box ? box.width : undefined,
            height: box ? box.height : undefined,
          });
          ctx.dragSession.update();
          const out = ctx.dragSession.drop();
          ctx.setDebugCursor(null);
          if (!out || out.ok !== true) {
            console.log('drop refused:', out && out.error, 'at', JSON.stringify(at));
          }
          return out;
        };
        /**
         * Report where a drop at a screen point would land — through the same
         * resolver the drag uses — and show it in the overlay, which is where the
         * indicator lives now (docs/LAYOUT.md, V4/V6).
         */
        const reportPlan = (label, at, tag) => {
          const Drop = require('../shared/drop-resolve');
          const plan = Drop.resolveDrop({ point: at, panes: ctx.paneList() });
          console.log(label, JSON.stringify({ tag, at: [Math.round(at.x), Math.round(at.y)], plan, target: Drop.toPlaceTarget(plan) }));
          const pane = plan && plan.paletteId ? ctx.paneList().find((p) => p.paletteId === plan.paletteId) : null;
          if (plan && plan.line && pane) {
            ctx.showOverlay(null, {
              text: 'drop',
              x: at.x,
              y: at.y,
              line: {
                x: pane.rect.x + plan.line.x * pane.zoom,
                y: pane.rect.y + plan.line.y * pane.zoom,
                length: plan.line.length * pane.zoom,
                axis: plan.line.axis,
              },
            });
          }
          return plan;
        };
        // The --listeners / --window-map probes run at the *end* of the flag sequence
        // (after the drop flags), so they read the state those flags produced — see below.
        const deletePal = argValue('--delete-palette');
        if (deletePal) {
          const wanted = String(deletePal).trim();
          const paletteId = !wanted || wanted === 'primary' ? ctx.primaryPaletteId() : wanted;
          const out = ctx.applyLayoutIntent({ type: 'palette.remove', paletteId });
          await new Promise((r) => setTimeout(r, 1500));
          const d = ctx.currentWorkspace();
          console.log('delete-palette:', JSON.stringify({
            ok: out && out.ok,
            error: out && out.error,
            windows: [...ctx.floatWins.keys()],
            palettes: d.palettes.map((p) => p.name),
          }));
        }
        const duplicatePal = argValue('--duplicate-palette');
        if (duplicatePal) {
          const wanted = String(duplicatePal).trim();
          const paletteId = !wanted || wanted === 'primary' ? ctx.primaryPaletteId() : wanted;
          const out = ctx.applyLayoutIntent({ type: 'palette.duplicate', paletteId });
          await new Promise((r) => setTimeout(r, 1800));
          const d = ctx.currentWorkspace();
          console.log('duplicate:', JSON.stringify({ ok: out && out.ok, palettes: d.palettes.map((p) => `${p.name}:${p.columns.map((c) => c.modules.map((m) => m.instanceId).join('+')).join('|')}`) }));
        }
        // Instance controls (Settings → Modules): add, duplicate, hide, show, remove. The
        // flags call the same primitives the IPC handlers do, so a script can drive them.
        const dumpWorkspace = (label, out) => {
          const doc = ctx.currentWorkspace();
          console.log(label, JSON.stringify({
            out: out ? { ok: out.ok, error: out.error, instanceId: out.instanceId, settingsCopied: out.settingsCopied } : null,
            palettes: doc.palettes.map((p) => `${p.name}:${p.columns.flatMap((c) => c.modules.map((m) => m.instanceId)).join('+')}`),
            hidden: (doc.hiddenInstances || []).map((h) => h.instanceId),
          }));
        };
        const findPlaced = (instanceId) => {
          const doc = ctx.currentWorkspace();
          for (const p of doc.palettes) for (const c of p.columns) for (const m of c.modules) if (m.instanceId === instanceId) return m;
          return null;
        };
        const moduleAdd = argValue('--module-add');
        if (moduleAdd) dumpWorkspace('module add:', ctx.applyLayoutIntent({ type: 'module.enable', moduleId: String(moduleAdd).trim() }));
        const moduleDup = argValue('--module-duplicate');
        if (moduleDup) {
          const src = String(moduleDup).trim();
          const found = findPlaced(src);
          const copyId = ctx.mintInstanceId('i');
          if (!found) dumpWorkspace('module duplicate:', { ok: false, error: 'unknown-instance' });
          else {
            const out = ctx.applyLayoutIntent({ type: 'module.enable', moduleId: found.moduleId, instanceId: copyId });
            const settingsCopied = out && out.ok ? ctx.moduleStore.copySettings(src, copyId) : false;
            dumpWorkspace('module duplicate:', { ...out, instanceId: copyId, settingsCopied });
          }
        }
        const moduleHide = argValue('--module-hide');
        if (moduleHide) dumpWorkspace('module hide:', ctx.applyLayoutIntent({ type: 'module.hide', instanceId: String(moduleHide).trim() }));
        const moduleShow = argValue('--module-show');
        if (moduleShow) dumpWorkspace('module show:', ctx.applyLayoutIntent({ type: 'module.show', instanceId: String(moduleShow).trim() }));
        const moduleRemove = argValue('--module-remove');
        if (moduleRemove) dumpWorkspace('module remove:', ctx.applyLayoutIntent({ type: 'module.remove', instanceId: String(moduleRemove).trim() }));
        const moduleMin = argValue('--module-min');
        if (moduleMin !== undefined) {
          // `--module-min <instanceId>[:0]` collapses (or expands with :0) one card.
          const [instanceId, mode] = String(moduleMin).split(':');
          dumpWorkspace('module minimize:', ctx.applyLayoutIntent({
            type: 'module.setCollapsed',
            instanceId: instanceId.trim(),
            collapsed: mode !== '0',
          }));
        }
        const summonAccel = argValue('--summon-hotkey');
        if (summonAccel !== undefined) {
          // Register the summon hotkey and report whether it took (docs/DEV.md).
          console.log('summon hotkey:', JSON.stringify(ctx.applySummonHotkey(String(summonAccel))));
        }
        const bindSpec = argValue('--bind');
        if (bindSpec) {
          // `--bind <instanceId>:<command>=<accel>[,<key>=<accel>…]` registers per-module
          // hotkeys and reports which took (docs/DEV.md).
          const bindings = { ...(ctx.settings.get().commandBindings || {}) };
          for (const part of String(bindSpec).split(',')) {
            const eq = part.indexOf('=');
            if (eq === -1) continue;
            const key = part.slice(0, eq).trim();
            if (key) bindings[key] = part.slice(eq + 1).trim();
          }
          console.log('bind:', JSON.stringify(ctx.applyCommandHotkeys(bindings)));
        }
        const commandSpec = argValue('--command');
        if (commandSpec) {
          // `--command <instanceId>:<name>[,<json args>]` calls a module command through the
          // kernel bus from the palette renderer, exercising the renderer -> main -> target
          // window path (docs/MODULES.md, "Module commands").
          const raw = String(commandSpec);
          const at = raw.indexOf(':');
          const target = (at === -1 ? raw : raw.slice(0, at)).trim();
          const rest = at === -1 ? '' : raw.slice(at + 1);
          const comma = rest.indexOf(',');
          const name = (comma === -1 ? rest : rest.slice(0, comma)).trim();
          let args = [];
          if (comma !== -1) {
            try { args = JSON.parse(rest.slice(comma + 1)); if (!Array.isArray(args)) args = [args]; } catch { args = []; }
          }
          // Retry for a moment: the target's window may still be mounting its modules.
          const js = `(async () => { const target = ${JSON.stringify(target)}, cmd = ${JSON.stringify(name)}, args = ${JSON.stringify(args)}; const deadline = Date.now() + 3000; let last = null; while (Date.now() < deadline) { try { const v = await window.Iro.commands.call(target, cmd, args); return JSON.stringify({ ok: true, value: v === undefined ? null : v }); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 100)); } } return JSON.stringify({ ok: false, error: String((last && last.message) || last) }); })()`;
          const out = await ctx.popup.webContents.executeJavaScript(js);
          console.log('command:', out);
        }
        const moduleSize = argValue('--module-size');
        if (moduleSize) {
          // Set a module's locked ratio: `--module-size <moduleId>=<ratio>` picks the first
          // placed instance of that module (the Module Size slider, scripted).
          const [mid, ratioRaw] = String(moduleSize).split('=');
          const moduleId = String(mid || '').trim();
          const ratio = Number(ratioRaw);
          let found = null;
          for (const p of ctx.currentWorkspace().palettes || []) {
            for (const c of p.columns || []) for (const m of c.modules || []) if (m.moduleId === moduleId) found = found || m;
          }
          if (found && Number.isFinite(ratio)) {
            dumpWorkspace('module size:', ctx.applyLayoutIntent({
              type: 'module.setHeight',
              instanceId: found.instanceId,
              height: { mode: 'ratio', ratio },
            }));
          } else {
            console.log('module size: not applied', JSON.stringify({ moduleId, ratio, found: Boolean(found) }));
          }
        }
        const movePal = argValue('--move-palette');
        if (movePal) {
          // `--move-palette <id|primary>@x,y` — a programmatic move, which is how a test
          // "drags" a palette: the window fires its own move/moved events either way.
          const m = /^([^@]+)@(-?\d+),(-?\d+)$/.exec(String(movePal).trim());
          if (m) {
            const paletteId = m[1] === 'primary' ? ctx.primaryPaletteId() : m[1];
            const out = ctx.applyLayoutIntent({
              type: 'palette.setBounds',
              paletteId,
              pos: { x: Number(m[2]), y: Number(m[3]) },
            });
            console.log('move-palette:', JSON.stringify({ paletteId, out: out ? { ok: out.ok, error: out.error } : null }));
            // Move the *window* too, not just the document: a window's move events are what
            // the release-time logic (dock on let-go, join/come-free an edge) listens to.
            const win = paletteId === ctx.primaryPaletteId() ? ctx.popup : ctx.floatWins.get(paletteId);
            if (win && !win.isDestroyed()) {
              const b = win.getBounds();
              win.setBounds({ x: Number(m[2]), y: Number(m[3]), width: b.width, height: b.height });
            }
            await new Promise((r) => setTimeout(r, 900));
          }
        }
        const dragPal = argValue('--drag-palette');
        if (dragPal) {
          // `--drag-palette <id|primary>@x,y` — a whole-palette drag through the session, the
          // same path a titlebar drag takes: the group hides, follows the cursor, and commits
          // its members' new positions on release (docs/LAYOUT.md, "Snap zones").
          const m = /^([^@]+)@(-?\d+),(-?\d+)$/.exec(String(dragPal).trim());
          if (m) {
            const paletteId = m[1] === 'primary' ? ctx.primaryPaletteId() : m[1];
            const win = paletteId === ctx.primaryPaletteId() ? ctx.popup : ctx.floatWins.get(paletteId);
            const members = ctx.paletteDragMembers(paletteId);
            if (win && !win.isDestroyed() && members.length) {
              const b = win.getBounds();
              ctx.setDebugCursor({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 10) });
              const pal = ctx.currentWorkspace().palettes.find((p) => p.id === paletteId) || {};
              const items = (pal.columns || []).flatMap((c) => (c.modules || []).map((m) => m.instanceId));
              const zb = (win.webContents && win.webContents.getZoomFactor && win.webContents.getZoomFactor()) || 1;
              const itemSize = { width: b.width / zb, height: b.height / zb };
              const started = ctx.dragSession.begin({ kind: 'palette', text: pal.name || '', members, sourcePaletteId: paletteId, items, itemSize });
              ctx.setDebugCursor({ x: Number(m[2]), y: Number(m[3]) });
              await new Promise((r) => setTimeout(r, 400));
              ctx.dragSession.update();
              const midLine = (ctx.overlayState && ctx.overlayState.line) || null;
              const midPlan = ctx.dragSession.state() && ctx.dragSession.state().plan ? ctx.dragSession.state().plan.kind : null;
              const out = ctx.dragSession.drop();
              ctx.setDebugCursor(null);
              console.log('drag-palette:', JSON.stringify({ midPlan, midLine, started, out }));
              await new Promise((r) => setTimeout(r, 600));
            }
          }
        }
        const exportWs = argValue('--export-workspace');
        if (exportWs) {
          const out = await ctx.exportWorkspaceTo(String(exportWs));
          console.log('export:', JSON.stringify(out));
        }
        const importWs = argValue('--import-workspace');
        if (importWs) {
          const out = await ctx.importWorkspaceFrom(String(importWs));
          console.log('import:', JSON.stringify({ ok: out && out.ok, error: out && out.error, path: out && out.path }));
          await new Promise((r) => setTimeout(r, 700));
        }
        const clickSel = argValue('--click');
        if (clickSel) {
          // Click anything by selector — a generic hook so UI with no dedicated flag
          // is still verifiable. --click-win <floatId> picks the window (default:
          // the palette).
          const winArg = argValue('--click-win');
          // `settings` targets the Settings window; otherwise a float id, else the
          // palette. (This default is what made an earlier N3 check report
          // `found:false`: it was looking in the palette for a Settings selector.)
          const target0 = winArg === 'settings'
            ? ctx.settingsWin
            : (winArg ? (floatWinFor(winArg) || popup) : popup);
          // `--open-settings` is handled later in this flow, so wait a moment for the
          // window rather than reporting a false negative (which is exactly how an
          // earlier N3 check looked like a broken UI).
          let target = target0;
          for (let i = 0; i < 25 && (!target || target.isDestroyed()); i += 1) {
            await new Promise((r) => setTimeout(r, 200));
            target = winArg === 'settings' ? ctx.settingsWin : popup;
          }
          if (!target || target.isDestroyed()) {
            console.log('[click]', clickSel, JSON.stringify({ found: false, noWindow: true }));
          } else {
          // A click can close the window it clicked in (Delete palette), which would leave this
          // await hanging forever and the shot app never quitting. Race it against a timeout.
          const res = await Promise.race([
            target.webContents.executeJavaScript(/* click code */ `(async () => {
               const sels = ${JSON.stringify(String(clickSel))}.split(',').map((s) => s.trim()).filter(Boolean);
               const clicked = [];
               for (const s of sels) {
                 const el = document.querySelector(s);
                 if (!el) return { found: false, missing: s };
                 el.click();
                 clicked.push(s);
                 await new Promise((r) => setTimeout(r, 120));
               }
               const menu = document.getElementById('palette-menu');
               const name = document.getElementById('palette-name');
               const del = document.getElementById('menu-delete');
               return {
                 found: true,
                 clicked,
                 menuOpen: menu ? !menu.classList.contains('hidden') : null,
                 nameReadonly: name ? name.readOnly : null,
                 nameValue: name ? name.value : null,
                 deleteLabel: del ? del.textContent : null,
                 active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
               };
             })()`),
            new Promise((resolve) => setTimeout(() => resolve({ found: true, closed: true }), 2500)),
          ]);
          await new Promise((r) => setTimeout(r, 800));
          console.log('[click]', clickSel, JSON.stringify({
            ...res,
            settingsWin: Boolean(ctx.settingsWin && !ctx.settingsWin.isDestroyed()),
          }));
          }
        }
        const selectIds = argValue('--select');
        if (selectIds) {
          // Select instances in a board (comma separated) so a following drag
          // carries the whole selection (docs/LAYOUT.md, V4).
          await popup.webContents.executeJavaScript(
            `window.__board?.select(${JSON.stringify(String(selectIds).split(',').map((s) => s.trim()))})`,
          );
          await new Promise((r) => setTimeout(r, 250));
        }
        const shiftSelect = argValue('--shift-select');
        if (shiftSelect) {
          // The shift rule through the real handler: press a, shift-press b, then
          // cancel (a cancel finishes without opening anything). Reports the range.
          const [a, b] = String(shiftSelect).split(',');
          const sel = await popup.webContents.executeJavaScript(
            `(() => {
               const head = (id) => document.querySelector('.module[data-instance=${JSON.stringify(a)}] .module-head');
               const headA = document.querySelector('.module[data-instance=${JSON.stringify(a)}] .module-head');
               const headB = document.querySelector('.module[data-instance=${JSON.stringify(b)}] .module-head');
               if (!headA || !headB) return null;
               const at = (el, extra) => {
                 const r = el.getBoundingClientRect();
                 return { bubbles: true, cancelable: true, button: 0, pointerId: 41, isPrimary: true, clientX: Math.round(r.left + 10), clientY: Math.round(r.top + 4), screenX: Math.round(window.screenX + r.left + 10), screenY: Math.round(window.screenY + r.top + 4), ...extra };
               };
               headA.dispatchEvent(new PointerEvent('pointerdown', at(headA)));
               headB.dispatchEvent(new PointerEvent('pointerdown', at(headB, { shiftKey: true })));
               document.dispatchEvent(new PointerEvent('pointercancel', at(headB)));
               return window.__board?.selection?.() ?? null;
             })()`,
          );
          console.log('shift-select:', JSON.stringify({ from: a, to: b, selection: sel }));
          await new Promise((r) => setTimeout(r, 200));
        }
        const pointerDrag = argValue('--pointer-drag');
        if (pointerDrag) {
          // Drive a *real* pointer drag through the board's own handlers and the
          // session: pointerdown, a move past the threshold, then pointerup with
          // the debug cursor parked on the target point (the session polls the
          // cursor, not the events). docs/LAYOUT.md, V4.
          const [inst, sx, sy] = String(pointerDrag).split(',');
          ctx.setDebugCursor({ x: Number(sx), y: Number(sy) });
          const started = await popup.webContents.executeJavaScript(
            `(() => {
               const card = document.querySelector('.module[data-instance=${JSON.stringify(inst)}] .module-head');
               if (!card) return 'no-card';
               const r = card.getBoundingClientRect();
               const base = { bubbles: true, cancelable: true, button: 0, pointerId: 31, isPrimary: true, clientX: Math.round(r.left + 12), clientY: Math.round(r.top + 6), screenX: Math.round(window.screenX + r.left + 12), screenY: Math.round(window.screenY + r.top + 6) };
               card.dispatchEvent(new PointerEvent('pointerdown', base));
               document.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: base.clientX + 30, clientY: base.clientY + 30, screenX: base.screenX + 30, screenY: base.screenY + 30 }));
               return 'down-and-move';
             })()`,
          );
          await new Promise((r) => setTimeout(r, 300));
          const mid = ctx.dragSession.state();
          const owMid = ctx.overlayWin;
          const midInfo = owMid && !owMid.isDestroyed() && owMid.isVisible()
            ? await owMid.webContents.executeJavaScript(
              `JSON.stringify({ win: [window.innerWidth, window.innerHeight], chip: (() => { const c = document.getElementById('overlay-chip'); if (!c) return null; const s = getComputedStyle(c); return [c.offsetLeft, c.offsetTop, c.offsetWidth, c.offsetHeight, s.backgroundColor, s.color, c.textContent]; })(), line: (() => { const l = document.getElementById('overlay-line'); if (!l) return null; const s = getComputedStyle(l); return [l.hidden, l.offsetLeft, l.offsetTop, l.offsetWidth, l.offsetHeight, s.backgroundColor]; })() })`,
            )
            : null;
          console.log('overlay MID-drag:', JSON.stringify({
            state: ctx.overlayState || null,
            win: owMid && !owMid.isDestroyed() ? { visible: owMid.isVisible(), onTop: owMid.isAlwaysOnTop(), bounds: owMid.getBounds() } : 'none',
            drawn: midInfo ? JSON.parse(midInfo) : null,
          }));
          if (owMid && !owMid.isDestroyed() && owMid.isVisible()) {
            const midImg = await owMid.webContents.capturePage();
            const midPath = shotPath.replace(/\.png$/i, '-middrag.png');
            fs.writeFileSync(midPath, midImg.toPNG());
            console.log(`mid-drag overlay screenshot written to ${midPath}`);
          }
          await popup.webContents.executeJavaScript(
            `document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 31, isPrimary: true }))`,
          );
          await new Promise((r) => setTimeout(r, 500));
          ctx.setDebugCursor(null);
          const after = JSON.stringify(ctx.readLayoutDoc().columns.map((c) => (c.modules || []).map((m) => m.instanceId)));
          console.log('overlay mid-drag:', JSON.stringify(ctx.overlayState || null));
          const ow = ctx.overlayWin;
          console.log('overlay window:', JSON.stringify(ow && !ow.isDestroyed() ? {
            visible: ow.isVisible(), onTop: ow.isAlwaysOnTop(), bounds: ow.getBounds(), box: ctx.overlayBox || null,
            popupOnTop: ctx.popup && !ctx.popup.isDestroyed() ? ctx.popup.isAlwaysOnTop() : null,
          } : 'none'));
          console.log('pointer drag:', JSON.stringify({
            started,
            plan: mid ? mid.plan : null,
            active: Boolean(mid),
            columns: after,
          }));
        }
        const pick = argValue('--pick');
        if (pick) {
          await popup.webContents.executeJavaScript(
            `(() => { const el = document.getElementById('hex'); el.value = ${JSON.stringify(pick)}; el.dispatchEvent(new Event('change')); })()`,
          );
          await new Promise((r) => setTimeout(r, 500));
        }
        const chroma = argValue('--chroma');
        if (chroma !== undefined) {
          // Drive the C slider, which may sit past the gamut boundary.
          await popup.webContents.executeJavaScript(
            `(() => { const el = document.getElementById('rng-C'); el.value = ${JSON.stringify(String(chroma))}; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); })()`,
          );
          await new Promise((r) => setTimeout(r, 500));
        }
        const clickSlot = argValue('--click');
        if (clickSlot) {
          await popup.webContents.executeJavaScript(`document.getElementById('slot-${clickSlot}')?.click()`);
          await new Promise((r) => setTimeout(r, 700));
        }
        if (process.argv.includes('--transparent')) {
          await popup.webContents.executeJavaScript(`window.__store?.applyIncoming({ transparent: true })`);
          await new Promise((r) => setTimeout(r, 400));
        }
        if (process.argv.includes('--collapse')) {
          await popup.webContents.executeJavaScript(`document.getElementById('btn-collapse')?.click()`);
          await new Promise((r) => setTimeout(r, 500));
          const p = ctx.layoutPalette(ctx.primaryPaletteId());
          console.log('collapse:', JSON.stringify({
            collapsed: p && p.collapsed,
            remembered: p && `${p.size.width}x${p.size.height}`,
            window: ctx.popup ? ctx.popup.getContentSize() : null,
          }));
        }
        const modulePopover = argValue('--module-popover');
        if (modulePopover) {
          // Open that module's settings window (its ⋯ button).
          await popup.webContents.executeJavaScript(
            `document.querySelector('.module[data-module="${modulePopover}"] .module-settings')?.click()`,
          );
          await new Promise((r) => setTimeout(r, 900));
        }
        const openPopover = argValue('--open-popover');
        if (openPopover) {
          const [moduleId, instanceId] = String(openPopover).split('=');
          ctx.openModuleSettingsWindow({ moduleId, instanceId });
          await new Promise((r) => setTimeout(r, 900));
        }
        const popoverShot = argValue('--popover-shot');
        if (popoverShot && ctx.moduleSettingsWin && !ctx.moduleSettingsWin.isDestroyed()) {
          const img = await ctx.moduleSettingsWin.webContents.capturePage();
          fs.writeFileSync(popoverShot, img.toPNG());
          console.log('popover screenshot written to', popoverShot);
        }
        // Drive the popup like a user would — the ⋯ panel has no other way in.
        const popoverClick = argValue('--popover-click');
        if (popoverClick && ctx.moduleSettingsWin && !ctx.moduleSettingsWin.isDestroyed()) {
          const clicked = await ctx.moduleSettingsWin.webContents.executeJavaScript(
            `(() => { const el = document.querySelector(${JSON.stringify(popoverClick)});
               if (!el) return { found: false };
               el.click();
               return { found: true, text: el.textContent }; })()`,
          );
          console.log('[popover-click]', popoverClick, JSON.stringify(clicked));
          await new Promise((r) => setTimeout(r, 900));
        }
        const popoverShotLate = argValue('--popover-shot-late');
        if (popoverShotLate && ctx.moduleSettingsWin && !ctx.moduleSettingsWin.isDestroyed()) {
          const img = await ctx.moduleSettingsWin.webContents.capturePage();
          fs.writeFileSync(popoverShotLate, img.toPNG());
          console.log('popover-late screenshot written to', popoverShotLate);
        }
        if (process.argv.includes('--palette-menu')) {
          // Click the palette's ☰ and report where the menu landed. The menu is drawn by the          // **overlay** window now — it has to be, since a renderer cannot paint outside its own
          // window — so this reports the overlay's real bounds (proof it is outside the palette)
          // and saves a picture.
          await popup.webContents.executeJavaScript(`document.getElementById('btn-menu')?.click()`);
          await new Promise((r) => setTimeout(r, 800));
          const ow = ctx.overlayWin;
          if (ow && !ow.isDestroyed() && ow.isVisible()) {
            const menuText = await ow.webContents.executeJavaScript(
              `JSON.stringify([...document.querySelectorAll('.overlay-menu-item')].map((n) => n.textContent))`,
            );
            const menuScroll = await ow.webContents.executeJavaScript(
              `(() => { const m = document.getElementById('overlay-menu');
                 return m ? { scrollHeight: m.scrollHeight, clientHeight: m.clientHeight,
                   scrolling: m.classList.contains('scrolling') } : null; })()`,
            );
            const img = await ow.webContents.capturePage();
            const menuPath = shotPath.replace(/\.png$/i, '-menu.png');
            fs.writeFileSync(menuPath, img.toPNG());
            console.log('palette-menu:', JSON.stringify({
              overlayBounds: ow.getBounds(),
              paletteBounds: popup.getBounds(),
              items: JSON.parse(menuText),
              scroll: menuScroll,
              file: menuPath,
            }));
          } else {
            console.log('palette-menu: the overlay never appeared');
          }
        }
        if (process.argv.includes('--report-panes')) {
          // Every palette/floating window's real bounds; the snap-splitter check compares these.
          const panes = [];
          if (ctx.popup && !ctx.popup.isDestroyed()) {
            panes.push({ id: ctx.primaryPaletteId(), kind: 'palette', bounds: ctx.popup.getBounds() });
          }
          for (const [id, win] of ctx.floatWins) {
            if (win && !win.isDestroyed()) panes.push({ id, kind: 'float', bounds: win.getBounds() });
          }
          console.log('panes:', JSON.stringify(panes));
        }
        const gripClick = argValue('--grip-click');
        if (gripClick) {
          await popup.webContents.executeJavaScript(
            `document.querySelector('.module[data-module="${gripClick}"] .module-settings')?.click()`,
          );
          await new Promise((r) => setTimeout(r, 900));
        }
        const gripPress = argValue('--grip-press');
        if (gripPress) {
          await popup.webContents.executeJavaScript(
            `(() => {
               const g = document.querySelector('.module[data-module="${gripPress}"] .module-head');
               if (!g) return 'no head';
               const r = g.getBoundingClientRect();
               const opts = { bubbles: true, cancelable: true, button: 0, pointerId: 1,
                 clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
               g.dispatchEvent(new PointerEvent('pointerdown', opts));
               document.dispatchEvent(new PointerEvent('pointerup', opts));
               return 'pressed';
             })()`,
          );
          await new Promise((r) => setTimeout(r, 900));
        }
        const moduleToggle = argValue('--module-toggle');
        if (moduleToggle && ctx.moduleSettingsWin && !ctx.moduleSettingsWin.isDestroyed()) {
          // Click the first control in the settings window that --module-popover
          // just opened.
          await ctx.moduleSettingsWin.webContents.executeJavaScript(
            `document.querySelector('#ms-root input, #ms-root select, #ms-root button')?.click()`,
          );
          await new Promise((r) => setTimeout(r, 400));
        }
        const boardSize = argValue('--board-size');
        if (boardSize) {
          // e.g. --board-size "i2=320,c1=180"  (module instance or column id)
          await popup.webContents.executeJavaScript(
            `(() => { const spec = ${JSON.stringify(boardSize)}; for (const part of String(spec).split(',')) { const [id, px] = part.split('='); if (window.__board && id && px) window.__board.resize(id.trim(), Number(px)); } })()`,
          );
          await new Promise((r) => setTimeout(r, 400));
        }
        const boardMove = argValue('--board-move');
        if (boardMove) {
          await popup.webContents.executeJavaScript(
            `(() => { const [id, col] = ${JSON.stringify(boardMove)}.split('='); if (window.__board && id && col) window.__board.moveModule(id.trim(), col.trim()); })()`,
          );
          await new Promise((r) => setTimeout(r, 400));
        }
        const boardDrag = argValue('--board-drag');
        if (boardDrag) {
          // e.g. --board-drag "i3=right"  or  "i1=c1:0"
          await popup.webContents.executeJavaScript(
            `(() => { const [id, spec] = ${JSON.stringify(boardDrag)}.split('='); if (window.__board && id && spec) window.__board.dragTo(id.trim(), spec.trim()); })()`,
          );
          await new Promise((r) => setTimeout(r, 500));
        }
        if (process.argv.includes('--board-add-column')) {
          await popup.webContents.executeJavaScript(`window.__board?.addColumn()`);
          await new Promise((r) => setTimeout(r, 600));
        }
        const renameTo = argValue('--rename-palette');
        if (renameTo) {
          // Rename through the window's own board, as typing in its titlebar does
          // (verifies palette:rename end to end, and the name coming back).
          await popup.webContents.executeJavaScript(`window.__board?.setPaletteName(${JSON.stringify(renameTo)})`);
          await new Promise((r) => setTimeout(r, 600));
        }
        const moduleSet = argValue('--module-set');
        if (moduleSet) {
          // Patch a module setting as if another window had done it, so the
          // palette re-reads it (e.g. --module-set color-slider=thickness:24).
          const [mid, pair] = String(moduleSet).split('=');
          const [key, raw] = String(pair || '').split(':');
          if (mid && key) {
            const stored = readModuleSettings(mid.trim()) || {};
            const value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
            stored[key.trim()] = value;
            writeModuleSettings(mid.trim(), stored, 1);
            if (popup && !popup.isDestroyed()) sendTo(popup, 'module:changed', { id: mid.trim() });
            await new Promise((r) => setTimeout(r, 700));
          }
        }
        if (process.argv.includes('--lock')) {
          await popup.webContents.executeJavaScript(`window.csp.updateSettings({ locked: true })`);
          await new Promise((r) => setTimeout(r, 300));
          console.log('[lock] popup resizable =', popup.isResizable(),
            'floats resizable =', JSON.stringify([...floatWins.values()].map((w) => w.isResizable())));
        }
        if (process.argv.includes('--hex-click')) {
          // Clicking the hex copies it and flashes "Copied!".
          await popup.webContents.executeJavaScript(`document.getElementById('hex').click()`);
          await new Promise((r) => setTimeout(r, 120));
          const hexInfo = await popup.webContents.executeJavaScript(
            `JSON.stringify({ v: document.getElementById('hex').value, cls: document.getElementById('hex').className })`,
          );
          console.log('[hex]', hexInfo);
        }
        if (process.argv.includes('--dock-hint')) {
          // Show the "a float will dock here" indicator on the palette.
          await popup.webContents.executeJavaScript(`window.__board?.setDockHint(true)`);
          await new Promise((r) => setTimeout(r, 300));
        }
        const hoverArg = argValue('--module-hover');
        if (hoverArg && popup && !popup.isDestroyed()) {
          // Hover an external module over the palette at one of its edges, so
          // the drop indicator can be screenshotted.
          const pal = popup.getBounds();
          const at = {
            left: { x: pal.x + 6, y: pal.y + pal.height / 2 },
            right: { x: pal.x + pal.width - 6, y: pal.y + pal.height / 2 },
            top: { x: pal.x + pal.width / 2, y: pal.y + 30 },
            bottom: { x: pal.x + pal.width / 2, y: pal.y + pal.height - 20 },
            middle: { x: pal.x + pal.width / 2, y: pal.y + 120 },
          }[hoverArg];
          if (at) {
            reportPlan('[module-hover]', at, hoverArg);
            await new Promise((r) => setTimeout(r, 300));
          }
        }
        const overlayText = argValue('--drag-overlay');
        if (overlayText) {
          // Show the drag chip *and* a drop indicator (one overlay window) so both
          // can be screenshotted. --drop-line is "screenX,screenY,length,axis".
          const lineArg = argValue('--drop-line');
          let line = 'null';
          if (lineArg) {
            const [lx, ly, len, axis] = String(lineArg).split(',');
            line = `{ x: ${Number(lx)}, y: ${Number(ly)}, length: ${Number(len)}, axis: ${JSON.stringify(axis || 'h')} }`;
          }
          await popup.webContents.executeJavaScript(
            `window.csp.dragOverlay({ text: ${JSON.stringify(overlayText)}, hint: false, x: screenX + 120, y: screenY + 160, line: ${line} })`,
          );
          await new Promise((r) => setTimeout(r, 600));
        }
        const floatId = argValue('--float');
        if (floatId) {
          await popup.webContents.executeJavaScript(`window.__board?.floatModule(${JSON.stringify(floatId)})`);
          await new Promise((r) => setTimeout(r, 900));
        }
        const dragHover = argValue('--drag-hover');
        if (dragHover && popup && !popup.isDestroyed()) {
          // Exercise the real drag path: start a drag in the palette and move the
          // pointer out to a float, then report the float's drop indicator.
          const [inst, fid] = String(dragHover).split('=');
          const win = fid ? floatWinFor(fid.trim()) : null;
          if (win && !win.isDestroyed()) {
            const b = win.getBounds();
            const sx = Math.round(b.x + b.width / 2);
            const sy = Math.round(b.y + b.height / 2);
            // The session polls the *cursor*, which a script cannot move — park the
            // debug cursor on the float so the plan is the one the drag aimed at.
            ctx.setDebugCursor({ x: sx, y: sy });
            await popup.webContents.executeJavaScript(`
              (() => {
                const head = document.querySelector('.module[data-instance="${inst.trim()}"] .module-head');
                if (!head) return 'no head';
                const r = head.getBoundingClientRect();
                head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 7,
                  clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
                  screenX: window.screenX + r.left, screenY: window.screenY + r.top }));
                document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, pointerId: 7,
                  clientX: -60, clientY: Math.round(r.top), screenX: ${sx}, screenY: ${sy} }));
                return 'ok';
              })()
            `);
            await new Promise((r) => setTimeout(r, 400));
            // The synthetic pointermove started the drag; read the plan the session
            // resolved from it and stop the drag (the overlay draws the indicator).
            const mid = ctx.dragSession.state();
          const owMid = ctx.overlayWin;
          const midInfo = owMid && !owMid.isDestroyed() && owMid.isVisible()
            ? await owMid.webContents.executeJavaScript(
              `JSON.stringify({ win: [window.innerWidth, window.innerHeight], chip: (() => { const c = document.getElementById('overlay-chip'); if (!c) return null; const s = getComputedStyle(c); return [c.offsetLeft, c.offsetTop, c.offsetWidth, c.offsetHeight, s.backgroundColor, s.color, c.textContent]; })(), line: (() => { const l = document.getElementById('overlay-line'); if (!l) return null; const s = getComputedStyle(l); return [l.hidden, l.offsetLeft, l.offsetTop, l.offsetWidth, l.offsetHeight, s.backgroundColor]; })() })`,
            )
            : null;
          console.log('overlay MID-drag:', JSON.stringify({
            state: ctx.overlayState || null,
            win: owMid && !owMid.isDestroyed() ? { visible: owMid.isVisible(), onTop: owMid.isAlwaysOnTop(), bounds: owMid.getBounds() } : 'none',
            drawn: midInfo ? JSON.parse(midInfo) : null,
          }));
          if (owMid && !owMid.isDestroyed() && owMid.isVisible()) {
            const midImg = await owMid.webContents.capturePage();
            const midPath = shotPath.replace(/\.png$/i, '-middrag.png');
            fs.writeFileSync(midPath, midImg.toPNG());
            console.log(`mid-drag overlay screenshot written to ${midPath}`);
          }
            console.log('[drag-hover]', inst.trim(), '->', JSON.stringify({ plan: mid ? mid.plan : null }));
            ctx.dragSession.cancel();
            ctx.setDebugCursor(null);
          }
        }
        const hoverFloat = argValue('--hover-float');
        if (hoverFloat) {
          // Hover an external module over a float at one of its edges, so the
          // float's cross-window drop indicator can be screenshotted.
          const [fid, where] = String(hoverFloat).split('@');
          const win = floatWinFor(fid.trim());
          if (win && !win.isDestroyed()) {
            const b = win.getBounds();
            const at = {
              left: { x: b.x + 6, y: Math.round(b.y + b.height / 2) },
              right: { x: b.x + b.width - 6, y: Math.round(b.y + b.height / 2) },
              top: { x: Math.round(b.x + b.width / 2), y: b.y + 8 },
              bottom: { x: Math.round(b.x + b.width / 2), y: b.y + b.height - 8 },
            }[where] || { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
            reportPlan('[hover-float]', at, where || 'middle');
            await new Promise((r) => setTimeout(r, 300));
          }
        }
        const dropIntoFloat = argValue('--drop-float');
        if (dropIntoFloat) {
          // Drag a palette module onto a float: --drop-float <instance>=<floatId>[@left|right|bottom]
          const [inst, rest] = String(dropIntoFloat).split('=');
          const [fid, where] = String(rest || '').split('@');
          const win = floatWinFor(fid);
          if (win && !win.isDestroyed()) {
            const b = win.getBounds();
            const at = {
              x: where === 'left' ? b.x + 8 : where === 'right' ? b.x + b.width - 8 : Math.round(b.x + b.width / 2),
              y: where === 'bottom' ? b.y + b.height - 8 : Math.round(b.y + 46),
            };
            dropAtPoint(inst, at);
            await new Promise((r) => setTimeout(r, 1200));
          }
        }

        /** A module in that float window (any one — the flags name a window). */
        const soleInstanceOf = (id) => {
          const target = id ? floatWinFor(id) : null;
          if (target) {
            const doc = ctx.readLayoutDoc();
            const entry = (doc.floats || []).find((f) => f.floatId === id);
            for (const column of (entry && entry.columns) || []) {
              if ((column.modules || []).length) return column.modules[0].instanceId;
            }
          }
          return id;
        };
        const dropToMain = argValue('--drop-main');
        if (dropToMain) {
          // Drag a float's module onto the palette: --drop-main <instance>[@left|right|middle]
          const [inst, where] = String(dropToMain).split('@');
          const win = floatWinFor(inst.trim());
          const pal = popup && !popup.isDestroyed() ? popup.getBounds() : null;
          if (win && !win.isDestroyed() && pal) {
            const at = where === 'left'
              ? { x: pal.x + 6, y: pal.y + Math.round(pal.height * 0.6) }
              : where === 'right'
                ? { x: pal.x + pal.width - 6, y: pal.y + Math.round(pal.height * 0.6) }
                : { x: pal.x + Math.round(pal.width / 2), y: pal.y + Math.round(pal.height * 0.6) };
            dropAtPoint(soleInstanceOf(inst.trim()), at);
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
        const dropNone = argValue('--drop-none');
        if (dropNone) {
          // Drag a module out to empty space (a new float), from the palette or
          // from the float that holds it.
          const inst = String(dropNone).trim();
          const win = floatWinFor(inst) || (popup && !popup.isDestroyed() ? popup : null);
          const pal = popup && !popup.isDestroyed() ? popup.getBounds() : null;
          if (win && !win.isDestroyed() && pal) {
            const at = { x: pal.x + pal.width + 420, y: pal.y + 40 };
            dropAtPoint(soleInstanceOf(inst), at);
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
        const dropSelf = argValue('--drop-self');
        if (dropSelf) {
          // Drop a module back onto its own window: it must stay put (a lost
          // module here is the "lone float disappears" bug).
          const inst = String(dropSelf).trim();
          const win = floatWinFor(inst);
          if (win && !win.isDestroyed()) {
            const b = win.getBounds();
            const at = { x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) };
            dropAtPoint(soleInstanceOf(inst), at);
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
        const moveFloat = argValue('--move-float');
        if (moveFloat) {
          // --move-float <floatId>=top|bottom|left|right[,<gap>]  (verifies the
          // edge snapping by placing the float just off the palette's side).
          const [fid, spec] = String(moveFloat).split('=');
          const win = floatWinFor(fid);
          const pal = popup && !popup.isDestroyed() ? popup.getBounds() : null;
          if (win && !win.isDestroyed() && pal && spec) {
            const [side, gapStr] = String(spec).split(',');
            const gap = Number(gapStr) || 0;
            const fb = win.getBounds();
            const pos = {
              top: [pal.x, pal.y - fb.height - gap],
              bottom: [pal.x, pal.y + pal.height + gap],
              left: [pal.x - fb.width - gap, pal.y],
              right: [pal.x + pal.width + gap, pal.y],
            }[side];
            if (pos) {
              win.setPosition(Math.round(pos[0]), Math.round(pos[1]));
              await new Promise((r) => setTimeout(r, 600));
              console.log('[move-float]', fid, side, 'gap', gap, '->', JSON.stringify(win.getBounds()));
            }
          }
        }
        if (process.argv.includes('--reclamp')) {
          // A monitor vanished: pull the windows back into a live work area.
          const moved = ctx.reclampFloats ? ctx.reclampFloats() : false;
          await new Promise((r) => setTimeout(r, 400));
          console.log('[reclamp] moved=', moved, 'floats=', JSON.stringify(
            [...floatWins.values()].map((w) => w.getBounds()),
          ));
        }
        const collapseFloat = argValue('--float-collapse');
        if (collapseFloat) {
          // Click the collapse eye in that float: the grip button for a board of
          // modules, or a lone module's header button (it has no grip).
          const win = floatWinFor(collapseFloat);
          if (win && !win.isDestroyed()) {
            await evalWin(win,
              `(document.getElementById('float-collapse')?.offsetParent
                 ? document.getElementById('float-collapse')
                 : document.querySelector('.module-collapse'))?.click()`);
            await new Promise((r) => setTimeout(r, 600));
            console.log('[float-collapse]', collapseFloat, JSON.stringify(win.getBounds()), 'min', JSON.stringify(win.getMinimumSize()), 'resizable', win.isResizable());
          }
        }
        const dockAt = argValue('--dock-at');
        if (dockAt) {
          // Dock a whole float at a palette-relative fraction (verifies the
          // merge-into-column vs insert-columns-at-a-seam behaviour).
          const [fid, frac] = String(dockAt).split('=');
          const win = floatWinFor(fid.trim());
          const pal = popup && !popup.isDestroyed() ? popup.getBounds() : null;
          if (win && !win.isDestroyed() && pal && frac) {
            // Let any pending float layout save flush before we read it back.
            await new Promise((r) => setTimeout(r, 800));
            const [fx, fy] = frac.split(',').map(Number);
            const at = {
              x: Math.round(pal.x + pal.width * (Number.isFinite(fx) ? fx : 0.5)),
              y: Math.round(pal.y + pal.height * (Number.isFinite(fy) ? fy : 0.7)),
            };
            ctx.dockFloatAt(fid.trim(), at);
            await new Promise((r) => setTimeout(r, 1000));
            console.log('[dock-at]', fid.trim(), JSON.stringify(at));
          }
        }
        const dockId = argValue('--dock');
        if (dockId) {
          const win = floatWinFor(dockId);
          if (win && !win.isDestroyed()) {
            await evalWin(win, `document.querySelector('.module-dock')?.click()`);
            await new Promise((r) => setTimeout(r, 700));
          }
        }
        const floatNear = argValue('--float-near');
        if (floatNear) {
          // Move the float over the palette to trigger the snap-to-dock path.
          const win = floatWinFor(floatNear);
          if (win && !win.isDestroyed() && popup && !popup.isDestroyed()) {
            // Let the float's module count flush before arming the dock.
            await new Promise((r) => setTimeout(r, 800));
            const pal = popup.getBounds();
            const fb = win.getBounds();
            // Centre the float's header (not the window) on the palette, so the
            // dock arms for wide floats too.
            win.setPosition(
              Math.round(pal.x + pal.width / 2 - fb.width / 2),
              Math.round(pal.y + 60),
            );
            await new Promise((r) => setTimeout(r, 200));
            const hid = await evalWin(win,
              `document.body.classList.contains('drag-hidden')`,
            ).catch(() => null);
            console.log('[float-near]', floatNear, 'hidden over palette =', hid);
            await new Promise((r) => setTimeout(r, 900));
          }
        }
        if (process.argv.includes('--settings-cycle')) {
          await popup.webContents.executeJavaScript(`window.csp.openSettings()`);
          await new Promise((r) => setTimeout(r, 500));
          if (ctx.settingsWin) {
            await ctx.settingsWin.webContents.executeJavaScript(
              `document.getElementById('qr-url').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`,
            );
            await new Promise((r) => setTimeout(r, 400));
            ctx.settingsWin.close();
            await new Promise((r) => setTimeout(r, 400));
          }
          console.log('[cycle] settingsOpen=', Boolean(ctx.settingsWin), 'windowVisible=', popup.isVisible());
        }
        if (process.argv.includes('--open-settings')) {
          await popup.webContents.executeJavaScript(`window.csp.openSettings()`);
          await new Promise((r) => setTimeout(r, 1500));
          if (ctx.settingsWin) {
            const tab = argValue('--settings-tab');
            if (tab) {
              await ctx.settingsWin.webContents.executeJavaScript(
                `document.querySelector('.seg-btn[data-tab="${tab}"]')?.click()`,
              );
              await new Promise((r) => setTimeout(r, 300));
            }
            const settingsModule = argValue('--settings-module');
            if (settingsModule) {
              await ctx.settingsWin.webContents.executeJavaScript(
                `document.querySelector('.module-row[data-module="${settingsModule}"]')?.click()`,
              );
              await new Promise((r) => setTimeout(r, 400));
            }
            if (process.argv.includes('--fake-update') && typeof ctx.setUpdateInfo === 'function') {
              const portable = process.argv.includes('--fake-portable');
              const v = '9.9.9';
              ctx.setUpdateInfo({
                available: true,
                version: v,
                url: `https://github.com/daisharaima/Iroiroppa/releases/tag/v${v}`,
                build: portable ? 'portable' : 'installer',
                downloads: {
                  setup: `https://github.com/daisharaima/Iroiroppa/releases/download/v${v}/Iroiroppa.Setup.${v}.exe`,
                  portable: `https://github.com/daisharaima/Iroiroppa/releases/download/v${v}/Iroiroppa-Portable-${v}.exe`,
                },
                downloadUrl: portable
                  ? `https://github.com/daisharaima/Iroiroppa/releases/download/v${v}/Iroiroppa-Portable-${v}.exe`
                  : `https://github.com/daisharaima/Iroiroppa/releases/download/v${v}/Iroiroppa.Setup.${v}.exe`,
              });
              await new Promise((r) => setTimeout(r, 250));
            }
            const settingsShot = argValue('--settings-shot');
            if (settingsShot && ctx.settingsWin) {
              const b = ctx.settingsWin.getBounds();
              const img = await ctx.settingsWin.webContents.capturePage();
              fs.writeFileSync(settingsShot, img.toPNG());
              console.log('settings-shot:', JSON.stringify({ bounds: b, visible: ctx.settingsWin.isVisible(), file: settingsShot }));
            }
            const settingsClick = argValue('--settings-click');
            if (settingsClick) {
              // Click anything in the Settings window by CSS selector. The instance controls
              // carry `data-instance-action`, so the whole feature is drivable from a script.
              const clicked = await ctx.settingsWin.webContents.executeJavaScript(
                `(() => { const el = document.querySelector(${JSON.stringify(settingsClick)});
                   if (!el) return { found: false };
                   el.click();
                   return { found: true, text: el.textContent }; })()`,
              );
              console.log('[settings-click]', settingsClick, JSON.stringify(clicked));
              await new Promise((r) => setTimeout(r, 900));
            }
            const settingsClick2 = argValue('--settings-click-2');
            if (settingsClick2) {
              const clicked2 = await ctx.settingsWin.webContents.executeJavaScript(
                `(() => { const el = document.querySelector(${JSON.stringify(settingsClick2)});
                   if (!el) return { found: false };
                   el.click();
                   return { found: true, text: el.textContent }; })()`,
              );
              console.log('[settings-click-2]', settingsClick2, JSON.stringify(clicked2));
              await new Promise((r) => setTimeout(r, 900));
            }
            const settingsInstance = argValue('--settings-instance');
            if (settingsInstance) {
              // Pick an instance in the Modules detail list (0 = the first). Verifies
              // per-instance settings end to end (N1).
              const picked = await ctx.settingsWin.webContents.executeJavaScript(
                `(() => { const rows = [...document.querySelectorAll('#module-detail .instance-row .instance-name')];
                   const row = rows[${Number(settingsInstance)}];
                   if (row) row.click();
                   return { rows: rows.map((c) => c.textContent), clicked: row ? row.textContent : null }; })()`,
              );
              console.log('[settings-instance]', JSON.stringify(picked));
              await new Promise((r) => setTimeout(r, 400));
            }
            const settingsToggle = argValue('--settings-toggle');
            if (settingsToggle) {
              // Click the n-th control in the selected module's detail pane.
              await ctx.settingsWin.webContents.executeJavaScript(
                `document.querySelectorAll('#module-detail .module-detail-body input, #module-detail .module-detail-body select')[${Number(settingsToggle) - 1}]?.click()`,
              );
              await new Promise((r) => setTimeout(r, 600));
            }
            if (process.argv.includes('--accent-popup')) {
              await ctx.settingsWin.webContents.executeJavaScript(`document.getElementById('btn-accent')?.click()`);
              await new Promise((r) => setTimeout(r, 400));
            }
            const sinfo = await ctx.settingsWin.webContents.executeJavaScript(
              `JSON.stringify({
                 state: document.getElementById('settings-state').textContent,
                 liveSync: document.getElementById('set-live').checked,
                 theme: document.documentElement.dataset.theme ?? null,
                 accent: document.getElementById('accent-hex')?.value ?? null,
                 popup: !document.getElementById('accent-popup')?.classList.contains('hidden'),
                 iw: window.innerWidth,
                 ih: window.innerHeight,
                 dpr: window.devicePixelRatio,
                 body: document.getElementById('settings-body')?.offsetHeight ?? null,
                 err: window.__renderError || null
               })`,
            );
            console.log('settings state:', sinfo);
            if (process.argv.includes('--settings-debug')) {
              const dbg = await ctx.settingsWin.webContents.executeJavaScript(`(async () => {
                const ws = await window.csp.getWorkspace();
                const hidden = await window.csp.listHidden();
                const dots = [...document.querySelectorAll('.instance-dot')].map((d) => d.className);
                const lights = [...document.querySelectorAll('.module-row')].map((r) => ({
                  m: r.dataset.module, on: r.querySelector('.module-light')?.classList.contains('on')
                }));
                return JSON.stringify({ ws, hidden, dots, lights });
              })()`);
              console.log('settings debug:', dbg);
            }
            const settingsShotLate = argValue('--settings-shot-late');
            if (settingsShotLate && ctx.settingsWin) {
              // Capture *after* the module/tab/click actions, so a verification
              // script can see the state they produced rather than the one before.
              const img = await ctx.settingsWin.webContents.capturePage();
              fs.writeFileSync(settingsShotLate, img.toPNG());
              console.log('settings shot late:', settingsShotLate);
            }
            // The model dropdown is the desktop overlay, so it must be captured from
            // that window (a settings/window shot cannot contain it).
            const menuShotLate = argValue('--menu-shot-late');
            if (menuShotLate) {
              const ow = ctx.overlayWin;
              if (ow && !ow.isDestroyed() && ow.isVisible()) {
                const img = await ow.webContents.capturePage();
                fs.writeFileSync(menuShotLate, img.toPNG());
                console.log('menu shot late:', JSON.stringify({ file: menuShotLate, bounds: ow.getBounds() }));
              } else {
                console.log('menu shot late: the overlay is not visible');
              }
            }
          }
        }
        // The What's New dialog, for a scripted look at the note/credits window.
        if (process.argv.includes('--whats-new')) {
          if (ctx.openWhatsNew && ctx.openWhatsNew()) {
            await new Promise((r) => setTimeout(r, 900));
            const whatsNewShot = argValue('--whats-new-shot');
            const win = ctx.whatsNewWin;
            if (whatsNewShot && win && !win.isDestroyed()) {
              const img = await win.webContents.capturePage();
              fs.writeFileSync(whatsNewShot, img.toPNG());
              console.log('whats-new shot:', JSON.stringify({ bounds: win.getBounds(), file: whatsNewShot }));
            }
          }
        }
        // A tiny UI-hygiene check, run inside the window: interactive targets too
        // small to hit, and text that is clipped. Shared by the palette and float
        // dumps so `--shot` reports it at whatever width the shot was taken.
        const UI_CHECK_JS = `(() => { try {
          const small = []; const overflow = [];
          const label = (n) => (n.id || String(n.className || '') || n.tagName).trim().slice(0, 28);
          const targets = document.querySelectorAll('button, input, select, textarea, [role="button"]');
          for (const n of targets) {
            const r = n.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.width < 12 || r.height < 12) small.push(label(n) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
          }
          let boxes = 0;
          for (const n of document.querySelectorAll('.module, .module-head, .brand, #titlebar, .panel, .name, .row, label')) {
            if (n.offsetWidth === 0 || n.offsetHeight === 0) continue;
            boxes += 1;
            if (n.scrollWidth > n.clientWidth + 1) overflow.push(label(n) + ' ' + n.clientWidth + '<' + n.scrollWidth);
          }
          return { n: targets.length, boxes, small: small.slice(0, 6), overflow: overflow.slice(0, 6) };
        } catch (e) { return { err: String((e && e.message) || e) }; } })()`;
        const info = await popup.webContents.executeJavaScript(
          `JSON.stringify({
             slots: [...document.querySelectorAll('.slot')].map((n) => ({ id: n.id, cls: n.className, bg: n.style.background, tip: n.title })),
             active: [...document.querySelectorAll('.slot.active')].map((n) => n.id),
             swatch: document.getElementById('swatch')?.style.background ?? null,
             hex: document.getElementById('hex')?.value ?? null,
             mode: document.getElementById('mode-status')?.textContent ?? null,
             profile: document.getElementById('profile-name')?.textContent ?? null,
             profileRows: document.querySelectorAll('.profile-item').length,
             cmax: document.getElementById('rng-C')?.max ?? null,
             outL: document.getElementById('out-L')?.textContent ?? null,
             outC: document.getElementById('out-C')?.textContent ?? null,
             valH: document.getElementById('val-H')?.value ?? document.getElementById('val-H')?.textContent ?? null,
             dir: document.getElementById('profile-dir')?.textContent ?? null,
             modules: [...document.querySelectorAll('.module')].map((n) => n.dataset.module),
             popovers: [...document.querySelectorAll('.module-popover:not(.hidden)')].map((n) => n.closest('.module')?.dataset.module),
             hueHidden: document.querySelector('.module[data-module="color-slices"] .panel:nth-of-type(3)')?.classList.contains('hidden') ?? null,
             paletteName: document.getElementById('palette-name')?.value ?? null,
             selection: (() => { try { return window.__board?.selection?.() ?? null; } catch { return null; } })(),
             ui: ${UI_CHECK_JS},
             cols: [...document.querySelectorAll('.column')].map((n) => ({ id: n.dataset.column, w: n.offsetWidth })),
             cards: [...document.querySelectorAll('.module')].map((n) => {
               const o = n.querySelector('[data-orientation]');
               return { i: n.dataset.instance, w: n.offsetWidth, h: n.offsetHeight, or: o ? o.dataset.orientation : null, tight: n.querySelector('.compact') ? 1 : 0 };
             }),
             minWin: window.__board ? Math.round(window.__board.minWindowSize().width) + 'x' + Math.round(window.__board.minWindowSize().height) : null,
             win: window.innerWidth + 'x' + window.innerHeight,
             winAt: [window.screenX, window.screenY],
             board: document.getElementById('board') ? document.getElementById('board').clientHeight : null,
             boardW: document.getElementById('board') ? document.getElementById('board').clientWidth : null,
             col: document.querySelector('.column') ? document.querySelector('.column').clientHeight : null,
             padL: (() => { const b = document.getElementById('board'); const c = b && b.querySelector('.module'); return b && c ? Math.round(c.getBoundingClientRect().left - b.getBoundingClientRect().left) : null; })(),
             gap12: (() => { const c = document.querySelector('.column'); const cards = c ? [...c.querySelectorAll('.module')] : []; return cards.length > 1 ? Math.round(cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().bottom) : null; })(),
             err: window.__renderError || null
           })`,
        );
        if (argValue('--listeners')) {
          // How many IPC listeners each renderer holds. A drag rebuilds boards; if a module's
          // subscription is not released, this number climbs until Electron warns about it.
          const report = async (win, label) => {
            if (!win || win.isDestroyed()) return;
            try {
              const n = await win.webContents.executeJavaScript('window.csp.listenerCounts()');
              console.log('listeners:', label, JSON.stringify(n));
            } catch { /* closed while asking */ }
          };
          await report(popup, 'palette');
          for (const [id, win] of ctx.floatWins) await report(win, 'float ' + id);
        }
        if (argValue('--window-map')) {
          // Every window's *rendered* instance ids, keyed by its palette id — the
          // equality probe : no instanceId may appear in two windows.
          const report = async (win, paletteId, label) => {
            if (!win || win.isDestroyed()) return;
            try {
              const ids = await win.webContents.executeJavaScript(
                "JSON.stringify([...document.querySelectorAll('.module')].map(e=>e.dataset.instance))");
              console.log('window-map:', JSON.stringify({ label, paletteId, instances: JSON.parse(ids) }));
            } catch { /* closed while asking */ }
          };
          await report(popup, ctx.primaryPaletteId(), 'palette');
          for (const [id, win] of ctx.floatWins) await report(win, id, 'float ' + id);
        }
        if (process.argv.includes('--shot-brief')) {
          // Only the numbers a layout check needs; the full dump is ~5x this.
          const brief = JSON.parse(info);
          console.log(`renderer brief: ${JSON.stringify({
            win: brief.win, cols: brief.cols, cards: brief.cards, err: brief.err,
          })}`);
        } else {
          console.log('renderer state:', info);
        }
        const evalJs = argValue('--eval');
        if (evalJs) {
          // A generic probe: evaluate an expression in the palette and print it.
          try {
            const out = await popup.webContents.executeJavaScript(
              `(() => { try { return (${String(evalJs)}); } catch (e) { return 'EVAL_ERROR: ' + (e && e.message); } })()`,
            );
            console.log('[eval]', JSON.stringify(out));
          } catch (e) {
            console.log('[eval] error', String((e && e.message) || e));
          }
        }
        const img = await popup.webContents.capturePage();
        fs.writeFileSync(shotPath, img.toPNG());
        console.log(`screenshot written to ${shotPath}`);
        if (ctx.settingsWin && !ctx.settingsWin.isDestroyed()) {
          const simg = await ctx.settingsWin.webContents.capturePage();
          const sPath = shotPath.replace(/\.png$/i, '-settings.png');
          fs.writeFileSync(sPath, simg.toPNG());
          console.log(`settings screenshot written to ${sPath}`);
        }
        for (const [floatInstance, floatWin] of floatWins) {
          if (!floatWin || floatWin.isDestroyed()) continue;
          const fimg = await floatWin.webContents.capturePage();
          const fPath = shotPath.replace(/\.png$/i, `-float-${floatInstance}.png`);
          fs.writeFileSync(fPath, fimg.toPNG());
          console.log(`float screenshot written to ${fPath}`);
          const finfo = await floatWin.webContents.executeJavaScript(
            `JSON.stringify({ body: document.body.className, dpr: window.devicePixelRatio, board: document.getElementById('board')?.className ?? null, win: [window.innerWidth, window.innerHeight], card: (() => { const c = document.querySelector('.module'); return c ? [c.offsetWidth, c.offsetHeight, c.style.flex, c.style.minHeight] : null; })(), col: (() => { const c = document.querySelector('.column'); return c ? [c.clientWidth, c.clientHeight] : null; })(), head: (() => { const h = document.querySelector('.module-head'); return h ? h.offsetHeight : null; })(), cols: (() => { try { return window.__board.getLayout().columns.map((c) => (c.modules || []).map((m) => m.instanceId)); } catch { return null; } })(), history: (window.__store && window.__store.history ? window.__store.history.length : 0), drop: Boolean(document.querySelector('.drop-line, .drop-edge')), collapsed: document.body.classList.contains('float-collapsed'), hasEye: Boolean(document.querySelector('.module-collapse')), gripEye: Boolean(document.getElementById('float-collapse')), name: document.getElementById('palette-name')?.value ?? null, ui: ${UI_CHECK_JS}, err: window.__renderError ?? null })`,
          );
          console.log(`float state ${floatInstance}: ${finfo} resizable=${floatWin.isResizable()}`);
        }
        if (ctx.overlayWin && !ctx.overlayWin.isDestroyed() && ctx.overlayWin.isVisible()) {
          const gimg = await ctx.overlayWin.webContents.capturePage();
          const gPath = shotPath.replace(/\.png$/i, '-overlay.png');
          fs.writeFileSync(gPath, gimg.toPNG());
          console.log(`overlay screenshot written to ${gPath}`);
          // The overlay draws two things; report both so a picture is not the only
          // evidence (`line[0]` is `hidden`, then left/top/width/height).
          const ginfo = await ctx.overlayWin.webContents.executeJavaScript(
            `JSON.stringify({ win: [window.innerWidth, window.innerHeight], chip: (() => { const c = document.getElementById('overlay-chip'); return c ? [c.offsetLeft, c.offsetTop, c.offsetWidth, c.offsetHeight] : null; })(), line: (() => { const l = document.getElementById('overlay-line'); return l ? [l.hidden, l.offsetLeft, l.offsetTop, l.offsetWidth, l.offsetHeight, getComputedStyle(l).backgroundColor] : null; })(), err: window.__renderError ?? null })`,
          );
          console.log('overlay state:', ginfo);
        }
        if (ctx.moduleSettingsWin && !ctx.moduleSettingsWin.isDestroyed()) {
          console.log('module settings bounds', JSON.stringify(ctx.moduleSettingsWin.getBounds()), 'visible', ctx.moduleSettingsWin.isVisible());
          const mimg = await ctx.moduleSettingsWin.webContents.capturePage();
          const mPath = shotPath.replace(/\.png$/i, '-module-settings.png');
          fs.writeFileSync(mPath, mimg.toPNG());
          console.log(`module settings screenshot written to ${mPath}`);
        }
      } catch (err) {
        console.error('screenshot failed:', err.message);
      }
      ctx.quoted = true;
      app.quit();
    }, Number(argValue('--shot-wait')) || 1800);
  });
}

module.exports = { runShot };
