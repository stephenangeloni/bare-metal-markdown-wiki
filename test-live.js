/* test-live.js — live-mode state machine: refresh, poll, editor open/save.
   Runs app.js's own functions against an in-memory folder shaped like the
   browser's File System Access handles, with a minimal fake page. Reads can be
   held or made to fail, so slow-share interleavings are deterministic.
   Run: node test-live.js */
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function grab(name) {
  const m = new RegExp('(async )?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('app.js: function ' + name + ' not found');
  let d = 0;
  for (let j = m.index; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}
const GRABBED = ['parseFrontmatter', 'buildIndex', 'renderLanding', 'route', 'loadLive', 'folderStamp', 'fileAt', 'readForEdit', 'saveFile',
  'applyLive', 'showPage', 'walkDir', 'chooseFolder', 'refreshLive', 'pollLive', 'editMsg', 'lockEditor', 'openEditor', 'saveEditor', 'cancelEditor'].map(grab).join('\n');

/* State variables mirror the `let` block at the top of app.js: a fix that adds one must add it here too. */
const factory = (0, eval)(`(function (env) {
  const el = env.el, location = env.location, document = env.document;
  const showDirectoryPicker = function () { return env.pick(); };
  const imgExtRe = /\\.png$/i, wikiName = 'W', IDB = { set: async function () {} };
  let RAW = [], PAGES = {}, IMAGES = {}, STEM = {}, mode = 'bundled', liveHandle = null, lastRefresh = 0, liveStamp = '', editing = null, shownPage = '', busy = false, tocHtml = '';
  let landingPage = env.landingPage || '';
  function closeNav() {} function renderSidebar() {} function renderTags() {} function placeToc() {} function markActive() {}
  function setMode(m) { env.label = m === 'live' ? liveHandle.name : 'bundled'; }
  function crumbHtml(slug) { return '<nav>' + slug + '</nav>'; }
  function outLinks() { return new Set(); }
  async function fileToDataURI(f) { return 'data:' + await f.text(); }
  function renderPage(slug) {
    const p = PAGES[slug];
    el('page').innerHTML = p ? 'PAGE ' + slug + ' | title=' + p.title + ' | tags=' + p.tags.join(',') + ' | ' + p.content : 'NOTFOUND ' + slug;
  }
  function renderHome() { el('page').innerHTML = 'HOME ' + Object.keys(PAGES).sort().join(','); }
  ${GRABBED}
  return {
    route: route, refreshLive: refreshLive, pollLive: pollLive, openEditor: openEditor, saveEditor: saveEditor, cancelEditor: cancelEditor, chooseFolder: chooseFolder,
    async start(h) { liveHandle = h; applyLive(await loadLive(h)); mode = 'live'; buildIndex(); setMode('live'); route(); },
    forceRefresh() { lastRefresh = 0; return refreshLive(); },
    get editing() { return editing; }, get pages() { return PAGES; }, get handle() { return liveHandle && liveHandle.name; }
  };
})`);

let clock = 1000;
function page(text) { return { bytes: Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'), modified: ++clock }; }
function textOf(f) { return f.bytes.toString('utf8'); }
function isFile(n) { return Buffer.isBuffer(n.bytes); }
function fakeFolder(name, tree) {
  const ctl = { hold: new Set(), pending: [], failOnce: new Set(), failAlways: new Set(), holdWrite: new Set(), pendingWrites: [] };
  function dir(node, prefix) {
    return {
      kind: 'directory',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async getDirectoryHandle(n) { if (!node[n] || isFile(node[n])) throw new Error('NotFoundError'); return dir(node[n], prefix + n + '/'); },
      async getFileHandle(n) { if (!node[n] || !isFile(node[n])) throw new Error('NotFoundError'); return file(node[n], n, prefix + n); },
      async *values() { for (const k of Object.keys(node)) yield isFile(node[k]) ? file(node[k], k, prefix + k) : Object.assign(dir(node[k], prefix + k + '/'), { name: k }); }
    };
  }
  function file(f, n, p) {
    return {
      kind: 'file', name: n,
      async getFile() {
        const snap = f.bytes; // a real File is a snapshot taken at getFile() time
        return {
          lastModified: f.modified,
          async text() { // Blob.text(): UTF-8 decode, undecodable bytes become U+FFFD, a BOM is dropped
            if (ctl.failAlways.has(p) || ctl.failOnce.delete(p)) throw new Error('NotReadableError');
            if (ctl.hold.has(p)) await new Promise(function (res) { ctl.pending.push({ path: p, res: res }); });
            return new TextDecoder().decode(snap);
          }
        };
      },
      async createWritable() {
        let buf = '';
        return {
          async write(s) { buf += s; },
          async close() {
            if (ctl.holdWrite.has(p)) await new Promise(function (res) { ctl.pendingWrites.push(res); });
            f.bytes = Buffer.from(buf, 'utf8'); f.modified = ++clock;
          }
        };
      }
    };
  }
  const root = Object.assign(dir(tree, ''), { name: name });
  return {
    root: root, ctl: ctl,
    releaseOne(p) { const i = ctl.pending.findIndex(function (x) { return x.path === p; }); if (i >= 0) ctl.pending.splice(i, 1)[0].res(); },
    releaseAll() { ctl.hold.clear(); ctl.holdWrite.clear(); ctl.pending.splice(0).forEach(function (x) { x.res(); }); ctl.pendingWrites.splice(0).forEach(function (r) { r(); }); }
  };
}
async function settle() { for (let i = 0; i < 30; i++) await new Promise(function (r) { setImmediate(r); }); }

function makeApp(opts) {
  opts = opts || {};
  const els = {}; let html = ''; let editorEls = null;
  function mk() { return { innerHTML: '', value: '', textContent: '', scrollTop: 0, readOnly: false, disabled: false, classList: { add() {}, remove() {}, toggle() {} }, focus() {} }; }
  const pageEl = mk();
  Object.defineProperty(pageEl, 'innerHTML', {
    get() { return html; },
    set(v) { html = v; editorEls = v.indexOf('id="editText"') !== -1 ? { editText: mk(), editMsg: mk() } : null; }
  });
  const env = {
    location: { hash: opts.hash || '' }, document: { hidden: false, title: '' }, landingPage: opts.landingPage || '', label: '', pick: null,
    el(id) { if (id === 'page') return pageEl; if (id === 'editText' || id === 'editMsg') return editorEls && editorEls[id]; return els[id] || (els[id] = mk()); }
  };
  const app = factory(env);
  return {
    app: app, env: env,
    screen() { return html; },
    editor() { return env.el('editText'); },
    msg() { const m = env.el('editMsg'); return m ? m.textContent : null; },
    go(hash) { env.location.hash = hash; app.route(); } // what a hashchange does
  };
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function check(problems, ok, what) { if (!ok) problems.push(what); }

// ---------- baseline: these pass on 279d840 and show the harness behaves like the lead's manual check ----------

test('baseline: an edit is saved and the saved text is shown', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'v2'; await w.app.saveEditor();
  const bad = [];
  check(bad, textOf(tree['Home.md']) === 'v2', 'file on disk is ' + JSON.stringify(textOf(tree['Home.md'])));
  check(bad, w.screen().includes('| v2'), 'screen: ' + w.screen());
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('baseline: a poll shows a change made by someone else', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  tree['Home.md'] = page('their v2'); await w.app.pollLive();
  if (!w.screen().includes('their v2')) throw new Error('screen: ' + w.screen());
});

test('baseline: saving over a newer version is refused and the text stays in the box', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'mine';
  tree['Home.md'] = page('theirs'); await w.app.saveEditor();
  const bad = [];
  check(bad, textOf(tree['Home.md']) === 'theirs', 'file on disk is ' + JSON.stringify(textOf(tree['Home.md'])));
  check(bad, w.editor() && w.editor().value === 'mine', 'editor text lost');
  check(bad, /Someone else/.test(w.msg() || ''), 'message: ' + w.msg());
  if (bad.length) throw new Error(bad.join('\n  '));
});

// ---------- refresh / poll ----------

test('two overlapping reloads do not drop pages or strip front matter', async function () {
  const tree = { 'Home.md': page('---\ntitle: Fancy\ntags: t1\n---\nhome v1'), 'Zed.md': page('zed v1') };
  const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Zed' }); await w.app.start(f.root);
  const bad = [];
  f.ctl.hold.add('Zed.md');
  const r1 = w.app.forceRefresh(); await settle();            // e.g. focus or the refresh button, slow share
  tree['Zed.md'] = page('zed v2');                            // someone else saves meanwhile
  const r2 = w.app.pollLive(); await settle();                // the 5 s timer fires while the first reload is still reading
  f.releaseOne('Zed.md'); await settle();                     // first reload finishes first
  check(bad, !/^NOTFOUND/.test(w.screen()), 'after the first reload finished the open page rendered as: ' + w.screen());
  f.releaseAll(); await r1; await r2; await settle();
  await w.app.pollLive();
  check(bad, w.app.pages.Home && w.app.pages.Home.title === 'Fancy', 'Home title is ' + JSON.stringify(w.app.pages.Home && w.app.pages.Home.title) + ', want "Fancy"');
  check(bad, w.app.pages.Home && w.app.pages.Home.tags.join() === 't1', 'Home tags are ' + JSON.stringify(w.app.pages.Home && w.app.pages.Home.tags) + ', want ["t1"]');
  check(bad, w.screen().includes('zed v2'), 'screen: ' + w.screen());
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('a reload that fails on one read is retried by the next poll', async function () {
  const tree = { 'Home.md': page('v1'), 'Other.md': page('o') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  tree['Home.md'] = page('their v2');
  f.ctl.failOnce.add('Other.md');
  await w.app.pollLive();                                     // sees the change, the reload hits one transient read error
  await w.app.pollLive();                                     // 5 s later, share is fine again
  if (!w.screen().includes('their v2')) throw new Error('still stale after a healthy poll: ' + w.screen());
});

test('a reload interrupted by opening an editor is not counted as shown', async function () {
  const tree = { 'A.md': page('a v1'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#B' }); await w.app.start(f.root);
  tree['A.md'] = page('a v2');
  f.ctl.hold.add('A.md');
  const r = w.app.pollLive(); await settle();                 // reload in flight
  await w.app.openEditor();                                   // user clicks Edit on B
  f.releaseAll(); await r; await settle();
  w.go('#A');                                                 // user leaves the editor through the sidebar
  await w.app.pollLive();
  if (!w.screen().includes('a v2')) throw new Error('A is stale after a healthy poll: ' + w.screen());
});

test('after a footnote click, a change by someone else is still shown', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  w.go('#fn-1');
  tree['Home.md'] = page('their v2'); await w.app.pollLive(); await w.app.pollLive();
  if (!w.screen().includes('their v2')) throw new Error('screen: ' + w.screen());
});

// ---------- editor ----------

test('after a footnote click, Edit opens the page that is on screen', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  w.go('#fn-1');
  await w.app.openEditor();
  if (!w.app.editing || w.app.editing.slug !== 'Home') throw new Error('editor did not open; editing = ' + JSON.stringify(w.app.editing));
});

test('after a footnote click, Cancel closes the editor', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  w.go('#fn-1');
  await w.app.openEditor();
  f.ctl.failOnce.add('Home.md');                              // the reload after Cancel hits a transient read error
  w.app.cancelEditor(); await settle();
  if (w.editor() || w.app.editing) throw new Error('editor still open; screen: ' + w.screen());
});

test('a slow Edit on page A does not replace the draft on page B', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  f.ctl.hold.add('A.md');
  const open = w.app.openEditor(); await settle();            // read of A stalls
  w.go('#B'); await w.app.openEditor(); w.editor().value = 'draft B';
  f.releaseAll(); await open; await settle();
  const bad = [];
  check(bad, w.editor() && w.editor().value === 'draft B', 'editor now holds ' + JSON.stringify(w.editor() && w.editor().value));
  check(bad, w.app.editing && w.app.editing.slug === 'B', 'editing = ' + JSON.stringify(w.app.editing && w.app.editing.slug));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('a slow save of page A does not wipe the draft on page B', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a edited';
  f.ctl.holdWrite.add('A.md');
  const save = w.app.saveEditor(); await settle();            // write of A stalls
  w.go('#B'); await w.app.openEditor(); w.editor().value = 'draft B';
  f.releaseAll(); await save; await settle();
  const bad = [];
  check(bad, w.editor() && w.editor().value === 'draft B', 'B editor: ' + (w.editor() ? JSON.stringify(w.editor().value) : 'gone, screen: ' + w.screen()));
  check(bad, w.app.editing && w.app.editing.slug === 'B', 'editing = ' + JSON.stringify(w.app.editing));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('text typed while a save is in flight is not silently dropped', async function () {
  const tree = { 'A.md': page('a') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a edited';
  f.ctl.holdWrite.add('A.md');
  const save = w.app.saveEditor(); await settle();
  const ta = w.editor();
  if (ta.readOnly || ta.disabled) { f.releaseAll(); await save; return; } // box locked while saving: nothing can be typed
  ta.value = 'a edited, plus a typo fix';
  f.releaseAll(); await save; await settle();
  if (!(w.editor() && w.editor().value === 'a edited, plus a typo fix' && w.app.editing)) throw new Error('box was editable during the save and the extra text is gone; screen: ' + w.screen());
});

test('a save that succeeds is never left as a dead editor when the follow-up reload fails', async function () {
  const tree = { 'Home.md': page('v1'), 'Other.md': page('o') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'v2';
  f.ctl.failOnce.add('Other.md');                             // the reload after the write hits one transient read error
  await w.app.saveEditor();
  const bad = [];
  check(bad, textOf(tree['Home.md']) === 'v2', 'file on disk is ' + JSON.stringify(textOf(tree['Home.md'])));
  if (w.editor()) {
    check(bad, !!w.app.editing, 'editor is on screen but editing is null, so Save is a silent no-op');
    check(bad, w.msg() !== 'Saving\u2026', 'message is stuck on "Saving\u2026" after the file was written');
  } else {
    await w.app.pollLive();
    check(bad, w.screen().includes('| v2'), 'screen after the next poll: ' + w.screen());
  }
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('a folder switch that fails to load does not redirect saves to the new folder', async function () {
  const treeA = { 'Home.md': page('A home') }; const a = fakeFolder('A', treeA);
  const treeB = { 'Home.md': page('B home'), 'Bad.md': page('x') }; const b = fakeFolder('B', treeB);
  b.ctl.failAlways.add('Bad.md');
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder();
  const bad = [];
  check(bad, w.env.label === w.app.handle, 'topbar says folder ' + w.env.label + ' and shows ' + JSON.stringify(w.screen()) + ', but edits go to folder ' + w.app.handle);
  await w.app.openEditor();
  if (w.editor()) { w.editor().value = 'edited'; await w.app.saveEditor(); }
  check(bad, textOf(treeB['Home.md']) === 'B home', 'B/Home.md on disk is now ' + JSON.stringify(textOf(treeB['Home.md'])));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('saving a page that is not UTF-8 does not destroy the characters it could not decode', async function () {
  const legacy = Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x0A]);   // "café\n" in Windows-1252
  const tree = { 'Legacy.md': page(legacy) }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Legacy' }); await w.app.start(f.root);
  await w.app.openEditor();
  if (w.editor()) { w.editor().value += 'one more line\n'; await w.app.saveEditor(); }
  if (!tree['Legacy.md'].bytes.includes(0xE9)) throw new Error('bytes on disk: ' + tree['Legacy.md'].bytes.toString('hex') + ' (e9 became ef bf bd)');
});

(async function () {
  let bad = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (e) { bad++; console.log('FAIL: ' + name + '\n  ' + e.message); }
  }
  console.log('test-live: ' + (tests.length - bad) + '/' + tests.length + ' passed');
  process.exit(bad ? 1 : 0);
})();
