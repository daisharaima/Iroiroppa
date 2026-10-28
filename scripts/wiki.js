#!/usr/bin/env node
'use strict';

// Tooling for the user guide in `wiki/`.
//
//   node scripts/wiki.js check     # offline gates; also run by test/wiki.test.js
//   node scripts/wiki.js fix       # normalise internal links to `Page.md`
//   node scripts/wiki.js publish   # copy the pages into the GitHub wiki, if it exists
//
// Why the pages live in this repository rather than only in a wiki: a GitHub wiki
// is a separate git repository with no pull requests, no review and no history in
// this repo, and on a free plan it does not exist at all for a private repository
// (the repo's `has_wiki` cannot be turned on). So `wiki/` is the source of truth —
// it renders in the repository's own file view, which is where the README points —
// and `publish` is the ready path for the day the repo is public or the wiki is
// enabled: it rewrites `Page.md` links to the wiki's `Page` form and pushes.
//
// The guide is written for people who do not program the app, so `check` also
// fails on developer vocabulary that would mean nothing to them.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'wiki');
const FURNITURE = ['_Sidebar.md', '_Footer.md'];
const ENTRY = 'Home.md';

/** Words and commands that must never reach a page written for a non-programmer. */
const BANNED = [
  { pattern: /\bnpm\b/, why: 'a package-manager command' },
  { pattern: /AGENTS\.md/, why: 'an agent-facing file' },
  { pattern: /--(?:shot|size|dev)\b/, why: 'a developer flag' },
  { pattern: /localhost/, why: 'a developer host name' },
];

const pagesOnDisk = () =>
  fs.readdirSync(WIKI).filter((f) => f.endsWith('.md') && !FURNITURE.includes(f)).sort();

const pageStems = () => new Set(pagesOnDisk().map((f) => f.slice(0, -3)));

const read = (file) => fs.readFileSync(path.join(WIKI, file), 'utf8');

/** Every `[text](target)` in a page, as targets — images have their own check. */
function linkTargets(text) {
  const withoutImages = text.replace(/!\[[^\]]*\]\([^)\s]+\)/g, '');
  return [...withoutImages.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/** Every `![alt](target)` image reference. */
function imageTargets(text) {
  return [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/**
 * The offline gates. Returns `{ ok, problems }` — no network, no Electron, so it
 * runs inside `npm test`.
 */
function check() {
  const problems = [];
  if (!fs.existsSync(WIKI)) return { ok: false, problems: ['wiki/ is missing'] };

  const pages = pagesOnDisk();
  const stems = pageStems();
  if (!pages.includes(ENTRY)) problems.push('wiki/Home.md (the entry page) is missing');

  const sidebar = fs.existsSync(path.join(WIKI, '_Sidebar.md')) ? read('_Sidebar.md') : '';
  if (!sidebar) problems.push('wiki/_Sidebar.md is missing');

  const listed = new Set(
    linkTargets(sidebar)
      .filter((t) => t.endsWith('.md'))
      .map((t) => t.slice(0, -3)),
  );
  for (const page of pages) {
    const stem = page.slice(0, -3);
    if (!listed.has(stem)) problems.push(`${page} is not linked from _Sidebar.md`);
  }
  for (const stem of listed) {
    if (!stems.has(stem)) problems.push(`_Sidebar.md links ${stem}.md, which does not exist`);
  }

  // Every module the app ships needs a place in the guide.
  const { MODULES } = require('../src/shared/module-manifest');
  const allText = pages.map((p) => read(p)).join('\n');
  for (const mod of MODULES) {
    if (!allText.includes(mod.name)) {
      problems.push(`module "${mod.name}" is not mentioned anywhere in wiki/`);
    }
  }

  for (const page of pages) {
    const text = read(page);
    if (!text.startsWith('# ')) problems.push(`${page} does not start with a level-1 heading`);
    for (const target of linkTargets(text)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      if (!target.endsWith('.md')) {
        problems.push(`${page}: link "${target}" should be a Page.md file`);
        continue;
      }
      const stem = target.slice(0, -3).replace(/^.*\//, '');
      if (!stems.has(stem)) problems.push(`${page}: link "${target}" has no page`);
    }
    for (const target of imageTargets(text)) {
      if (!fs.existsSync(path.join(WIKI, target))) {
        problems.push(`${page}: image "${target}" is missing`);
      }
    }
    for (const rule of BANNED) {
      const hit = rule.pattern.exec(text);
      if (hit) problems.push(`${page}: contains ${hit[0]} (${rule.why})`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Parse `--flag value` / `--flag` from argv. */
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
}

/**
 * Normalise internal links to `Page.md`, so they work in the repository's file
 * view. A link already ending in `.md`, an external URL, or a file (an image) is
 * left alone.
 */
function fix() {
  const stems = pageStems();
  let changed = 0;
  for (const page of [...pagesOnDisk(), ...FURNITURE]) {
    const file = path.join(WIKI, page);
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(/\]\(([A-Za-z0-9_-]+)\)/g, (match, target) =>
      stems.has(target) ? `](${target}.md)` : match);
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed += 1;
    }
  }
  console.log(`wiki:links — normalised ${changed} page(s)`);
}

/** The wiki repository, derived from `origin` so nothing is hard-coded. */
function wikiRemote() {
  let origin = '';
  try {
    origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (err) {
    // A confined shell can block the child process outright; say which it was.
    throw new Error(`could not read git remote "origin" (${err.code || err.message})`);
  }
  return origin.replace(/\.git$/, '') + '.wiki.git';
}

const redact = (url) => url.replace(/x-access-token:[^@]+@/, 'x-access-token:***@');

/**
 * Copy `wiki/` into the wiki repository and push it. Reads the credential from
 * `gh auth token` (never from argv) and disables git's credential-helper prompt,
 * which cannot run under a restricted shell.
 */
function publish() {
  const remote = wikiRemote();
  let token = '';
  try {
    token = execFileSync('gh', ['auth', 'token'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    throw new Error('gh is not authenticated — run `gh auth login` first');
  }
  const authed = remote.replace('https://', `https://x-access-token:${token}@`);
  const gitArgs = ['-c', 'credential.helper=', '-c', 'http.sslBackend=openssl'];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iroiroppa-wiki-'));
  const run = (args, opts = {}) => execFileSync('git', [...gitArgs, ...args], {
    cwd: opts.cwd || tmp,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });

  try {
    try {
      run(['clone', '--quiet', authed, tmp], { cwd: os.tmpdir(), capture: true });
    } catch {
      console.error(`Could not clone ${redact(remote)}.`);
      console.error('A GitHub wiki only exists for a public repository, or a private one on a paid plan.');
      console.error('Until then the guide in wiki/ is published through the repository itself (see README).');
      console.error('To publish by hand once a wiki exists (the page bodies are the files in wiki/):');
      console.error(`  git clone ${remote} /tmp/iroiroppa.wiki`);
      console.error('  cp wiki/*.md /tmp/iroiroppa.wiki/   # rewrite Page.md links to Page');
      console.error('  cd /tmp/iroiroppa.wiki && git add -A && git commit -m "docs(wiki): publish user guide" && git push');
      return false;
    }
    // A wiki git repository starts with its own home page; replace the lot, but
    // keep `.git` so the history stays continuous.
    for (const entry of fs.readdirSync(tmp)) {
      if (entry !== '.git') fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(WIKI)) {
      const from = path.join(WIKI, entry);
      if (fs.statSync(from).isDirectory()) {
        fs.cpSync(from, path.join(tmp, entry), { recursive: true });
      } else {
        // Wiki pages link by page name, not by file name.
        const body = fs.readFileSync(from, 'utf8').replace(/\]\(([A-Za-z0-9_-]+)\.md\)/g, ']($1)');
        fs.writeFileSync(path.join(tmp, entry), body);
      }
    }
    run(['add', '-A']);
    const staged = run(['status', '--porcelain'], { capture: true }).trim();
    if (!staged) {
      console.log(`wiki:publish — ${redact(remote)} is already up to date`);
      return true;
    }
    run(['-c', 'user.name=Iroiroppa', '-c', 'user.email=daisharaima@users.noreply.github.com',
      'commit', '-m', `${argValue('--message') || 'docs(wiki): publish the user guide'}`]);
    run(['push', 'origin', 'HEAD']);
    console.log(`wiki:publish — pushed ${staged.split('\n').length} file change(s) to ${redact(remote)}`);
    return true;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] || 'check';
  if (command === 'check') {
    const { ok, problems } = check();
    for (const problem of problems) console.error(`wiki:check — ${problem}`);
    console.log(ok
      ? `wiki:check — ok (${pagesOnDisk().length} pages, ${require('../src/shared/module-manifest').MODULES.length} modules covered)`
      : `wiki:check — ${problems.length} problem(s)`);
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (command === 'fix') return fix();
  if (command === 'publish') {
    process.exitCode = publish() ? 0 : 1;
    return;
  }
  console.error(`usage: node scripts/wiki.js [check|fix|publish]`);
  process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { check, fix, publish, pagesOnDisk };
