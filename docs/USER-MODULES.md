# User modules

Bundled modules live in the repo (`src/renderer/selector_module/`). A **user
module** is one you drop into a folder and the app loads on the next start —
no build step, no signing. This is the authoring guide; `docs/MODULES.md` is the
module contract in full.

## Where it goes

```
%APPDATA%\Iroiroppa\
  user-modules\
    hello-module\
      module.json     optional metadata (recommended)
      module.js       the module (required)
      icon.svg        optional assets, served over module://
```

The folder name is the module **id** (lower-case letters, digits, `-`, `_`;
`hello-module`, not `Hello Module`). It must match the `id` the module registers.
The directory is `user-modules`, **not** `modules` — the latter holds per-instance
settings JSON.

A user module may **not** take a bundled module's id; a bundled id always wins
and the user folder is ignored. Unset `--user-module <dir>` uses a different root
for a scripted run (`docs/DEV.md`).

## `module.json` (optional, recommended)

```json
{
  "name": "Hello Module",
  "group": "utility",
  "autoHeight": true,
  "instanceable": true
}
```

| Field | Meaning | Default |
| --- | --- | --- |
| `name` | shown in Settings → Modules and the card head | the folder id |
| `group` | Modules-tab section: `core`, `picker` or `utility` | `utility` |
| `autoHeight` | size to content instead of a column share | `false` |
| `instanceable` | `false` makes it a singleton (at most one) | `true` |
| `defaultRatio` | locked height ÷ width (overrides `autoHeight`) | none |

## `module.js`

A classic script (no ES modules — the renderer is a `file://` page) that
registers itself on `window.Iro.modules`, exactly like a bundled one. The full
contract is `docs/MODULES.md` §4; the short version:

```js
(function () {
  const reg = (window.Iro = window.Iro || {});
  reg.modules = reg.modules || {};
  reg.modules['hello-module'] = {
    id: 'hello-module',
    name: 'Hello Module',
    version: 1,
    defaults: { greeting: 'Hello' },
    autoHeight: true,
    minSize() { return { width: 160, height: 30 }; },   // smallest box that fits
    settingsUI(api, root) { /* the settings popover, optional */ },
    create(ctx) {
      // ctx.el       the element to fill
      // ctx.color    the shared colour store (read state, request changes)
      // ctx.csp      the window.csp bridge
      // ctx.settings get() / patch(partial)  — persisted per instance
      // ctx.log      a namespaced logger
      return {
        commands: { greet: () => 'hi' },  // callable by other modules / hotkeys
        onResize(rect) {}, onSettings(next) {}, settings(root) {},
        destroy() {},                      // release listeners here
      };
    },
  };
})();
```

It **reads** colour from `ctx.color` and **requests** changes; it never owns
colour state. Release anything you subscribe to in `destroy()` (a module's
`destroy` runs whenever the board rebuilds, so a leaked listener repeats).

Copy `examples/hello-module/` into `user-modules/hello-module/` to see all of
this working.

## Commands

A `commands` map returned from `create(ctx)` makes each name callable by
**instance id** through the kernel command bus — another module via
`window.Iro.commands.call(instanceId, name, args)`, or a system-wide hotkey bound
in Settings → General → Module shortcuts. Commands are async and
JSON-serializable. `docs/MODULES.md` → "Module commands" has the full surface.

## Trust

A user module is **arbitrary JavaScript with the app's own privileges**: it holds
`ctx.csp`, so it can write the colour CSP stores and open the Settings window.
There is no sandbox, by design (the same trust class as a VS Code extension).
Treat installing a user module as running its author's code — only install one
you trust.

## Seeing it load

- Copy the folder in and restart the app; the module appears in Settings →
  Modules (its group section), and `＋` adds an instance.
- For a scripted run, point `--user-module <dir>` at a root holding the module
  folder and take a `--shot`; the module mounts like any other.
