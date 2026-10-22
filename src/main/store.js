'use strict';

// Tiny JSON-file store. Used for settings.json and session.json.

const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  /**
   * @param {string} file          absolute path to the JSON file
   * @param {object} defaults      values returned for missing keys
   */
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = this._read();
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...this.defaults, ...parsed };
    } catch {
      return { ...this.defaults };
    }
  }

  get() {
    return { ...this.data };
  }

  /** Shallow-merge a patch and persist. Returns the new value. */
  set(patch) {
    this.data = { ...this.data, ...patch };
    this._write();
    return this.get();
  }

  /** Overwrite the whole record. */
  replace(value) {
    this.data = { ...value };
    this._write();
    return this.get();
  }

  clear() {
    this.data = { ...this.defaults };
    this._write();
    return this.get();
  }

  _write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      // Write a sibling temp file, then rename: an atomic replace means a crash
      // mid-write cannot leave a truncated settings/history file.
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      // Persisting is best-effort; a read-only location must not crash the app.
      process.emitWarning(`could not write ${this.file}: ${err.message}`);
    }
  }
}

module.exports = { JsonStore };
