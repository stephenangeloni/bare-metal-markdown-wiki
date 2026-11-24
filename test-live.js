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
    set(v) { html = v; editorEls = {}; ['editText', 'editMsg', 'editSave', 'editCancel'].forEach(function (id) { if (v.indexOf('id="' + id + '"') !== -1) editorEls[id] = mk(); }); }
  });
  const env = {
    location: { hash: opts.hash || '' }, document: { hidden: false, title: '' }, landingPage: opts.landingPage || '', label: '', pick: null,
    el(id) { if (id === 'page') return pageEl; if (/^edit(Text|Msg|Save|Cancel)$/.test(id)) return (editorEls && editorEls[id]) || null; return els[id] || (els[id] = mk()); }
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

// ---------- save, reload and folder-switch interleavings ----------

function t(name, fn) { test(name, async function () { const bad = await fn(); if (bad.length) throw new Error(bad.join('\n  ')); }); }
function gateStamp(f) { // lets a folder walk read every entry, then holds it open until release()
  const orig = f.root.values.bind(f.root); const g = { on: false, waiters: [] };
  f.root.values = async function* () { yield* orig(); if (g.on) await new Promise(function (r) { g.waiters.push(r); }); };
  g.release = function () { g.on = false; g.waiters.splice(0).forEach(function (r) { r(); }); };
  return g;
}

t('a second Save click while the first is in flight writes nothing and the editor is locked', async function () {
  const tree = { 'A.md': page('a') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a edited';
  f.ctl.holdWrite.add('A.md');
  const s1 = w.app.saveEditor(); await settle();
  const s2 = w.app.saveEditor(); await settle();
  const bad = [];
  check(bad, f.ctl.pendingWrites.length === 1, 'writes in flight: ' + f.ctl.pendingWrites.length);
  check(bad, w.editor().readOnly === true, 'textarea not read-only');
  check(bad, w.env.el('editSave').disabled === true && w.env.el('editCancel').disabled === true, 'buttons not disabled');
  f.releaseAll(); await s1; await s2; await settle();
  check(bad, textOf(tree['A.md']) === 'a edited', 'disk: ' + textOf(tree['A.md']));
  check(bad, !w.editor() && !w.app.editing && w.screen().includes('| a edited'), 'screen: ' + w.screen());
  return bad;
});

t('a refused save unlocks the editor again', async function () {
  const tree = { 'A.md': page('a') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'mine';
  tree['A.md'] = page('theirs'); await w.app.saveEditor();
  const bad = [];
  check(bad, w.editor() && w.editor().readOnly === false, 'textarea still read-only');
  check(bad, w.env.el('editSave').disabled === false && w.env.el('editCancel').disabled === false, 'buttons still disabled');
  check(bad, w.app.editing && w.app.editing.saving === false, 'saving flag still set');
  return bad;
});

t('a write that throws unlocks the editor and says so', async function () {
  const tree = { 'A.md': page('a') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'mine';
  f.ctl.failOnce.add('A.md');                                  // saveFile's own read of the current file fails
  await w.app.saveEditor();
  const bad = [];
  check(bad, w.editor() && w.editor().value === 'mine' && w.editor().readOnly === false, 'editor lost or locked');
  check(bad, /^Could not save/.test(w.msg() || ''), 'message: ' + w.msg());
  check(bad, textOf(tree['A.md']) === 'a', 'disk: ' + textOf(tree['A.md']));
  await w.app.saveEditor();                                    // retry works
  check(bad, textOf(tree['A.md']) === 'mine', 'retry did not write; disk: ' + textOf(tree['A.md']));
  return bad;
});

t('leaving during the write does not throw (lockEditor is not called on a missing editor) and the save is picked up by the next poll', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a edited';
  f.ctl.holdWrite.add('A.md');
  const save = w.app.saveEditor(); await settle();
  w.go('#B');                                                  // user walks away mid-write
  f.releaseAll(); await save; await settle();                  // an exception in saveEditor would reject here
  const bad = [];
  check(bad, w.screen().startsWith('PAGE B'), 'screen: ' + w.screen());
  await w.app.pollLive(); w.go('#A');
  check(bad, w.screen().includes('| a edited'), 'A after poll: ' + w.screen());
  return bad;
});

t('while the reload after a save is still reading, a draft started on another page survives', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a edited';
  const hold = gateStamp(f); hold.on = true;                   // the reload's folder walk stalls
  const save = w.app.saveEditor(); await settle();
  const bad = [];
  check(bad, textOf(tree['A.md']) === 'a edited', 'disk: ' + textOf(tree['A.md']));
  w.go('#B'); await settle();
  await w.app.openEditor();
  check(bad, !!w.editor(), 'could not open B while the reload was in flight');
  if (w.editor()) w.editor().value = 'draft B';
  hold.release(); await save; await settle();
  check(bad, w.editor() && w.editor().value === 'draft B', 'B draft: ' + (w.editor() ? w.editor().value : 'gone; screen ' + w.screen()));
  check(bad, w.app.editing && w.app.editing.slug === 'B', 'editing = ' + JSON.stringify(w.app.editing));
  return bad;
});

t('busy is released after a failed stamp check and after a failed reload', async function () {
  const tree = { 'Home.md': page('v1'), 'Other.md': page('o') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  const orig = f.root.values.bind(f.root); let boom = 1;
  f.root.values = async function* () { if (boom-- > 0) throw new Error('NetworkError'); yield* orig(); };
  await w.app.pollLive();                                      // stamp check throws
  tree['Home.md'] = page('v2'); f.ctl.failOnce.add('Other.md');
  await w.app.pollLive();                                      // reload throws
  const ok = await w.app.forceRefresh();                       // the refresh button must still work
  const bad = [];
  check(bad, ok === true, 'refresh returned ' + ok + ' (busy stuck?)');
  check(bad, w.screen().includes('| v2'), 'screen: ' + w.screen());
  return bad;
});

t('Edit pressed twice on a slow drive opens one editor and keeps what was typed', async function () {
  const tree = { 'A.md': page('a') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  f.ctl.hold.add('A.md');
  const o1 = w.app.openEditor(); await settle();
  const o2 = w.app.openEditor(); await settle();
  f.releaseOne('A.md'); await o1; await settle();
  w.editor().value = 'typed';
  f.releaseAll(); await o2; await settle();
  return w.editor() && w.editor().value === 'typed' ? [] : ['editor: ' + (w.editor() && w.editor().value)];
});

t('a reload of folder A that finishes after a switch to folder B must not put A back on screen', async function () {
  const treeA = { 'Home.md': page('A home'), 'Slow.md': page('s') }; const a = fakeFolder('A', treeA);
  const treeB = { 'Home.md': page('B home') }; const b = fakeFolder('B', treeB);
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  a.ctl.hold.add('Slow.md');
  const r = w.app.forceRefresh(); await settle();              // focus or the refresh button; A is slow
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder();                                  // user switches to B meanwhile
  const bad = [];
  check(bad, w.screen().includes('B home'), 'right after the switch: ' + w.screen());
  a.releaseAll(); await r; await settle();                     // A's reload finishes
  check(bad, w.screen().includes('B home'), 'topbar says ' + w.env.label + ', edits go to ' + w.app.handle + ', screen shows: ' + w.screen());
  check(bad, !w.app.pages.Slow, 'index holds A\'s pages: ' + Object.keys(w.app.pages));
  await w.app.pollLive();
  if (bad.length) bad.push('(after the next poll: ' + w.screen() + ')');
  return bad;
});

t('switching folder after a footnote click must show the new folder', async function () {
  const treeA = { 'Home.md': page('A home') }; const a = fakeFolder('A', treeA);
  const treeB = { 'Home.md': page('B home') }; const b = fakeFolder('B', treeB);
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  w.go('#fn-1');
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder();
  const bad = [];
  check(bad, w.screen().includes('B home'), 'topbar says ' + w.env.label + ', screen shows: ' + w.screen());
  await w.app.pollLive(); await w.app.pollLive();
  if (bad.length) bad.push('(after two more polls: ' + w.screen() + ')');
  return bad;
});

t('switching folder after a footnote click while an editor is open must not leave that editor pointed at the new folder', async function () {
  const treeA = { 'Home.md': page('same') }; const a = fakeFolder('A', treeA);
  const treeB = { 'Home.md': page('same') }; treeB['Home.md'].modified = treeA['Home.md'].modified; const b = fakeFolder('B', treeB); // e.g. a copy of the folder
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  w.go('#fn-1');
  await w.app.openEditor(); w.editor().value = 'meant for A';
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder();
  if (w.editor()) await w.app.saveEditor();
  const bad = [];
  check(bad, textOf(treeB['Home.md']) === 'same', 'B/Home.md on disk is now ' + JSON.stringify(textOf(treeB['Home.md'])) + '; A/Home.md is ' + JSON.stringify(textOf(treeA['Home.md'])));
  return bad;
});

t('Save pressed while an earlier reload is still reading must not show the old text as the result', async function () {
  const tree = { 'Home.md': page('v1'), 'Slow.md': page('s') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  f.ctl.hold.add('Slow.md');
  const r = w.app.forceRefresh(); await settle();              // reload in flight: Home.md already read, stuck on Slow.md
  await w.app.openEditor(); w.editor().value = 'v2'; const s = w.app.saveEditor(); await settle();
  const bad = [];
  check(bad, textOf(tree['Home.md']) === 'v2', 'disk: ' + textOf(tree['Home.md']));
  check(bad, !w.screen().includes('| v1'), 'right after Save the screen shows: ' + w.screen());
  f.releaseAll(); await r; await s; await settle();
  check(bad, w.screen().includes('| v2'), 'after the earlier reload finished: ' + w.screen());
  await w.app.pollLive();
  if (bad.length) bad.push('(after the next poll: ' + w.screen() + ')');
  return bad;
});

function holdNextHandle(f) {
  const orig = f.root.getFileHandle.bind(f.root); const g = { armed: true, release: null };
  f.root.getFileHandle = async function (n) { if (g.armed) { g.armed = false; await new Promise(function (res) { g.release = res; }); } return orig(n); };
  return g;
}

t('a draft started on another page during the wait survives (the re-check after the wait)', async function () {
  const tree = { 'Home.md': page('v1'), 'Slow.md': page('s'), 'Other.md': page('o') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  f.ctl.hold.add('Slow.md');
  const r = w.app.forceRefresh(); await settle();
  await w.app.openEditor(); w.editor().value = 'v2';
  const s = w.app.saveEditor(); await settle();
  w.go('#Other'); await w.app.openEditor();
  const bad = [];
  check(bad, !!w.editor(), 'could not open Other during the wait');
  if (w.editor()) w.editor().value = 'draft O';
  f.releaseAll(); await r; await s; await settle();
  await new Promise(function (res) { setTimeout(res, 250); }); await settle();
  check(bad, w.editor() && w.editor().value === 'draft O', 'draft: ' + (w.editor() ? w.editor().value : 'gone; screen ' + w.screen()));
  check(bad, w.app.editing && w.app.editing.slug === 'Other', 'editing = ' + JSON.stringify(w.app.editing));
  check(bad, textOf(tree['Home.md']) === 'v2', 'disk: ' + textOf(tree['Home.md']));
  return bad;
});

t('a save of A that is refused after the user left does not throw and says nothing in page B\'s editor', async function () {
  const bad = [];
  for (const draft of [false, true]) {
    const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
    const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
    await w.app.openEditor(); w.editor().value = 'mine';
    const g = holdNextHandle(f);
    let threw = null;
    const s = w.app.saveEditor().catch(function (e) { threw = e; }); await settle();
    tree['A.md'] = page('theirs');
    w.go('#B');
    if (draft) { await w.app.openEditor(); w.editor().value = 'draft B'; }
    g.release(); await s; await settle();
    check(bad, !threw, (draft ? 'with' : 'without') + ' a draft on B, saveEditor threw: ' + (threw && threw.message));
    check(bad, textOf(tree['A.md']) === 'theirs', 'disk: ' + textOf(tree['A.md']));
    if (draft) check(bad, w.editor() && w.editor().value === 'draft B' && !w.msg(), 'B editor: ' + (w.editor() ? JSON.stringify(w.editor().value) + ', message ' + JSON.stringify(w.msg()) : 'gone'));
  }
  return bad;
});

(async function () {
  let bad = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (e) { bad++; console.log('FAIL: ' + name + '\n  ' + e.message); }
  }
  console.log('test-live: ' + (tests.length - bad) + '/' + tests.length + ' passed');
  process.exit(bad ? 1 : 0);
})();
