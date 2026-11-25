'use strict';


const grab = require('./test-grab.js');
const GRABBED = ['titleOf', 'parseFrontmatter', 'buildIndex', 'renderLanding', 'route', 'loadLive', 'folderStamp', 'fileAt', 'versionOf', 'readForEdit', 'saveFile',
  'applyLive', 'showPage', 'walkDir', 'showFolder', 'chooseFolder', 'refreshLive', 'pollLive', 'editMsg', 'lockEditor', 'openEditor', 'saveEditor', 'cancelEditor',
  'splitLines', 'matchLines', 'merge3', 'changedLines', 'checkEditedPage', 'mergeIncoming', 'showChanges', 'reconcile', 'putMerged', 'showConflicts', 'pickConflict'].map(grab).join('\n');

const factory = (0, eval)(`(function (env) {
  const el = env.el, location = env.location, document = env.document;
  const showDirectoryPicker = function () { return env.pick(); };
  const imgExtRe = /\\.png$/i, wikiName = 'W', IDB = { set: async function () {} };
  let RAW = [], PAGES = {}, IMAGES = {}, STEM = {}, mode = 'bundled', liveHandle = null, lastRefresh = 0, liveStamp = '', editing = null, shownPage = '', loading = null, tocHtml = '';
  let landingPage = env.landingPage || '';
  function closeNav() {} function renderSidebar() {} function renderTags() {} function placeToc() {} function markActive() {}
  function setMode(m) { env.label = m === 'live' ? liveHandle.name : 'bundled'; }
  function crumbHtml(slug) { return '<nav>' + slug + '</nav>'; }
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
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
    mergeIncoming: mergeIncoming, showChanges: showChanges, pickConflict: pickConflict,
    async start(h) { applyLive(await loadLive(h)); liveHandle = h; mode = 'live'; buildIndex(); setMode('live'); route(); },
    forceRefresh() { lastRefresh = 0; return refreshLive(); },
    get editing() { return editing; }, get pages() { return PAGES; }, get handle() { return liveHandle && liveHandle.name; }
  };
})`);

let clock = Date.now();
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
      async getFileHandle(n, opts) {
        if (!node[n]) { if (!opts || !opts.create) throw new Error('NotFoundError'); node[n] = page(''); }
        return file(node[n], n, prefix + n);
      },
      async removeEntry(n) { if (!node[n]) throw new Error('NotFoundError'); delete node[n]; },
      async *values() { for (const k of Object.keys(node)) { if (!node[k]) continue; yield isFile(node[k]) ? file(node[k], k, prefix + k) : Object.assign(dir(node[k], prefix + k + '/'), { name: k }); } }
    };
  }
  function file(f, n, p) {
    return {
      kind: 'file', name: n,
      async getFile() {
        const snap = f.bytes;
        return {
          lastModified: f.modified,
          async text() {
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
  function mk() {
    return { innerHTML: '', value: '', textContent: '', scrollTop: 0, readOnly: false, disabled: false, selectionStart: 0, selectionEnd: 0,
      classList: { add() {}, remove() {}, toggle() {} }, focus() {}, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
  }
  const pageEl = mk();
  Object.defineProperty(pageEl, 'innerHTML', {
    get() { return html; },
    set(v) { html = v; editorEls = {}; ['editText', 'editMsg', 'editSave', 'editCancel', 'editAlert', 'editConflicts'].forEach(function (id) { if (v.indexOf('id="' + id + '"') !== -1) editorEls[id] = mk(); }); }
  });
  const env = {
    location: { hash: opts.hash || '' }, document: { hidden: false, title: '' }, landingPage: opts.landingPage || '', label: '', pick: null,
    el(id) { if (id === 'page') return pageEl; if (/^edit(Text|Msg|Save|Cancel|Alert|Conflicts)$/.test(id)) return (editorEls && editorEls[id]) || null; return els[id] || (els[id] = mk()); }
  };
  const app = factory(env);
  return {
    app: app, env: env,
    screen() { return html; },
    editor() { return env.el('editText'); },
    msg() { const m = env.el('editMsg'); return m ? m.textContent : null; },
    alert() { const a = env.el('editAlert'); return a ? a.innerHTML : null; },
    conflicts() { const c = env.el('editConflicts'); return c ? c.innerHTML : null; },
    go(hash) { env.location.hash = hash; app.route(); }
  };
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function check(problems, ok, what) { if (!ok) problems.push(what); }

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

test('editing writes nothing beside the page', async function () {
  const tree = { 'A.md': page('a') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); await w.app.pollLive();
  if (Object.keys(tree).join(',') !== 'A.md') throw new Error('folder while editing: ' + Object.keys(tree));
});

test('while editing, a poll notices their save and offers a merge without touching my text', async function () {
  const tree = { 'Home.md': page('v1\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'v1 mine\n';
  const bad = [];
  await w.app.pollLive();
  check(bad, w.alert() === '', 'a warning with nothing changed: ' + w.alert());
  tree['Home.md'] = page('their v2\n'); await w.app.pollLive();
  check(bad, /Someone else saved this page/.test(w.alert()) && /data-edit="merge"/.test(w.alert()), 'no merge offer: ' + w.alert());
  check(bad, w.editor() && w.editor().value === 'v1 mine\n', 'the draft box changed: ' + (w.editor() ? w.editor().value : 'gone'));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('merging their save into my draft keeps both edits, and the next save writes them', async function () {
  const tree = { 'Home.md': page('title\nintro\nmiddle\nend\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'title\nmy intro\nmiddle\nend\n';
  tree['Home.md'] = page('title\nintro\nmiddle\nend\ntheir line\n'); await w.app.pollLive();
  w.app.mergeIncoming();
  const bad = [];
  check(bad, w.editor().value === 'title\nmy intro\nmiddle\nend\ntheir line\n', 'draft after merge: ' + JSON.stringify(w.editor().value));
  check(bad, w.alert() === '', 'the warning stayed: ' + w.alert());
  await w.app.pollLive();
  check(bad, w.alert() === '', 'the merged version was reported again: ' + w.alert());
  await w.app.saveEditor();
  check(bad, textOf(tree['Home.md']) === 'title\nmy intro\nmiddle\nend\ntheir line\n', 'file on disk: ' + JSON.stringify(textOf(tree['Home.md'])));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('merging keeps my cursor on the text I was typing', async function () {
  const tree = { 'Home.md': page('a\nb\nc\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a\nb\nc mine\n'; w.editor().setSelectionRange(10, 10);
  tree['Home.md'] = page('their first line\na\nb\nc\n'); await w.app.pollLive();
  w.app.mergeIncoming();
  const v = w.editor().value, at = w.editor().selectionStart;
  if (v.slice(0, at) !== 'their first line\na\nb\nc mine') throw new Error('cursor after merge sits after ' + JSON.stringify(v.slice(0, at)));
});

test('merging keeps a cursor at the end of my text before the lines they added at the end', async function () {
  const tree = { 'Home.md': page('a\nb\nc\nd\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().setSelectionRange(8, 8);
  tree['Home.md'] = page('a\nb\nc\nd\ne\n'); await w.app.pollLive();
  w.app.mergeIncoming();
  if (w.editor().selectionStart !== 8) throw new Error('cursor after merge at ' + w.editor().selectionStart + ', expected 8 (before their new line)');
});

test('a save of identical text raises no warning and the next save goes through', async function () {
  const tree = { 'Home.md': page('a\nb\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a\nb mine\n';
  tree['Home.md'] = page('a\nb\n'); await w.app.pollLive();
  const bad = [];
  check(bad, w.alert() === '', 'warning for a save that changed nothing: ' + w.alert());
  await w.app.saveEditor();
  check(bad, textOf(tree['Home.md']) === 'a\nb mine\n', 'file on disk: ' + JSON.stringify(textOf(tree['Home.md'])));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('a Windows line-ending page keeps them through a merge and through a clash', async function () {
  const tree = { 'Home.md': page('a\r\nb\r\nc\r\nd\r\ne\r\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a mine\nb\nc\nd\ne mine\n';
  tree['Home.md'] = page('a\r\nb\r\nc theirs\r\nd\r\ne\r\n'); await w.app.pollLive();
  w.app.mergeIncoming();
  const bad = [];
  check(bad, w.editor().value === 'a mine\nb\nc theirs\nd\ne mine\n', 'draft after merge: ' + JSON.stringify(w.editor().value));
  tree['Home.md'] = page('a\r\nb\r\nc theirs\r\nd\r\ne theirs\r\n'); await w.app.saveEditor();
  check(bad, /e theirs/.test(w.conflicts() || ''), 'no clash offered: ' + w.conflicts());
  w.app.pickConflict(Number(/data-k="(\d+)"/.exec(w.conflicts())[1]), 'mine'); await w.app.saveEditor();
  check(bad, textOf(tree['Home.md']) === 'a mine\r\nb\r\nc theirs\r\nd\r\ne mine\r\n', 'file on disk: ' + JSON.stringify(textOf(tree['Home.md'])));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('a re-save that only changes line endings raises no warning, and Save keeps the new endings', async function () {
  const tree = { 'Home.md': page('a\r\nb\r\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a\nb mine\n';
  tree['Home.md'] = page('a\nb\n'); await w.app.pollLive();
  const bad = [];
  check(bad, w.alert() === '', 'warning: ' + w.alert());
  await w.app.saveEditor();
  check(bad, textOf(tree['Home.md']) === 'a\nb mine\n', 'file on disk: ' + JSON.stringify(textOf(tree['Home.md'])));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('a warning clears when they put the page back as it was', async function () {
  const tree = { 'Home.md': page('v1\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor();
  tree['Home.md'] = page('v2\n'); await w.app.pollLive();
  tree['Home.md'] = page('v1\n'); await w.app.pollLive();
  if (w.alert() !== '') throw new Error('warning after the revert: ' + w.alert());
});

test('a slow check that finishes after their save was merged raises no warning', async function () {
  const tree = { 'Home.md': page('a\nb\nc\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a mine\nb\nc\n';
  tree['Home.md'] = page('a\nb\nc theirs\n');
  f.ctl.hold.add('Home.md'); const slow = w.app.pollLive(); await settle(); f.ctl.hold.delete('Home.md');
  await w.app.pollLive(); w.app.mergeIncoming();
  f.releaseAll(); await slow; await settle();
  if (w.alert() !== '') throw new Error('warning for the version already merged: ' + w.alert());
});

test('Keep both adds only the lines that differ, not the ones we both wrote', async function () {
  const tree = { 'Home.md': page('Old title\nold body\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'New title\nmine\n';
  tree['Home.md'] = page('New title\ntheirs\n'); await w.app.pollLive(); w.app.mergeIncoming();
  w.app.pickConflict(Number(/data-k="(\d+)"/.exec(w.conflicts())[1]), 'both');
  if (w.editor().value !== 'New title\ntheirs\nmine\n') throw new Error('draft: ' + JSON.stringify(w.editor().value));
});

test('markup in their text is shown as text in both previews', async function () {
  const tree = { 'Home.md': page('a\nb\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a\nb <i>mine</i>\n';
  tree['Home.md'] = page('a\nb <img src=x> & co\n'); await w.app.pollLive();
  w.app.showChanges(); const changes = w.alert(); w.app.mergeIncoming();
  const bad = [];
  check(bad, !/<img|<i>/.test(changes) && /&amp; co/.test(changes), 'what changed: ' + changes);
  check(bad, !/<img|<i>/.test(w.conflicts()) && /&amp; co/.test(w.conflicts()), 'conflicts: ' + w.conflicts());
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('show what changed lists the lines they removed and added', async function () {
  const tree = { 'Home.md': page('a\nb\nc\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor();
  tree['Home.md'] = page('a\nB\nc\n'); await w.app.pollLive();
  w.app.showChanges();
  if (!w.alert().includes('<pre>- b\n+ B</pre>')) throw new Error('alert: ' + w.alert());
});

test('a merge that overlaps locks the box and asks, conflict by conflict, which side to keep', async function () {
  const tree = { 'Home.md': page('a\nb\nc\nd\ne\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a mine\nb\nc\nd\ne mine\n';
  tree['Home.md'] = page('a theirs\nb\nc theirs\nd\ne theirs\n'); await w.app.pollLive();
  w.app.mergeIncoming();
  const bad = [];
  check(bad, w.editor().readOnly && w.env.el('editSave').disabled, 'the box or Save stayed usable during the choice');
  check(bad, w.conflicts().includes('a theirs') && w.conflicts().includes('a mine') && w.conflicts().includes('e mine'), 'conflicts shown: ' + w.conflicts());
  const k = /data-k="(\d+)"/g, ks = []; let x; while ((x = k.exec(w.conflicts()))) if (ks.indexOf(x[1]) < 0) ks.push(x[1]);
  check(bad, ks.length === 2, 'expected 2 conflicts, got ' + ks.length);
  w.app.pickConflict(Number(ks[0]), 'mine');
  check(bad, w.editor().readOnly, 'the box unlocked with a conflict still open');
  w.app.pickConflict(Number(ks[1]), 'both');
  check(bad, w.editor().value === 'a mine\nb\nc theirs\nd\ne theirs\ne mine\n', 'resolved draft: ' + JSON.stringify(w.editor().value));
  check(bad, !w.editor().readOnly && !w.env.el('editSave').disabled && w.conflicts() === '', 'still locked after every conflict was decided');
  await w.app.saveEditor();
  check(bad, textOf(tree['Home.md']) === 'a mine\nb\nc theirs\nd\ne theirs\ne mine\n', 'file on disk: ' + JSON.stringify(textOf(tree['Home.md'])));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('saving over their save on other lines merges and saves', async function () {
  const tree = { 'Home.md': page('a\nb\nc\n') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a mine\nb\nc\n';
  tree['Home.md'] = page('a\nb\nc theirs\n'); await w.app.saveEditor();
  const bad = [];
  check(bad, textOf(tree['Home.md']) === 'a mine\nb\nc theirs\n', 'file on disk: ' + JSON.stringify(textOf(tree['Home.md'])));
  check(bad, !w.app.editing, 'the editor stayed open');
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('saving over their save on the same lines writes nothing and asks which side to keep', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'mine';
  tree['Home.md'] = page('theirs'); await w.app.saveEditor();
  const bad = [];
  check(bad, textOf(tree['Home.md']) === 'theirs', 'file on disk is ' + JSON.stringify(textOf(tree['Home.md'])));
  check(bad, w.editor() && w.editor().value === 'mine', 'editor text lost');
  check(bad, /Someone else/.test(w.msg() || ''), 'message: ' + w.msg());
  check(bad, w.conflicts().includes('theirs') && w.conflicts().includes('data-side="mine"'), 'no choice offered: ' + w.conflicts());
  w.app.pickConflict(0, 'mine'); await w.app.saveEditor();
  check(bad, textOf(tree['Home.md']) === 'mine', 'after keeping mine, file on disk is ' + JSON.stringify(textOf(tree['Home.md'])));
  if (bad.length) throw new Error(bad.join('\n  '));
});

test('two overlapping reloads do not drop pages or strip front matter', async function () {
  const tree = { 'Home.md': page('---\ntitle: Fancy\ntags: t1\n---\nhome v1'), 'Zed.md': page('zed v1') };
  const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Zed' }); await w.app.start(f.root);
  const bad = [];
  f.ctl.hold.add('Zed.md');
  const r1 = w.app.forceRefresh(); await settle();
  tree['Zed.md'] = page('zed v2');
  const r2 = w.app.pollLive(); await settle();
  f.releaseOne('Zed.md'); await settle();
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
  await w.app.pollLive();
  await w.app.pollLive();
  if (!w.screen().includes('their v2')) throw new Error('still stale after a healthy poll: ' + w.screen());
});

test('a reload interrupted by opening an editor is not counted as shown', async function () {
  const tree = { 'A.md': page('a v1'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#B' }); await w.app.start(f.root);
  tree['A.md'] = page('a v2');
  f.ctl.hold.add('A.md');
  const r = w.app.pollLive(); await settle();
  await w.app.openEditor();
  f.releaseAll(); await r; await settle();
  w.go('#A');
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
  f.ctl.failOnce.add('Home.md');
  w.app.cancelEditor(); await settle();
  if (w.editor() || w.app.editing) throw new Error('editor still open; screen: ' + w.screen());
});

test('a slow Edit on page A does not replace the draft on page B', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  f.ctl.hold.add('A.md');
  const open = w.app.openEditor(); await settle();
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
  const save = w.app.saveEditor(); await settle();
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
  if (ta.readOnly || ta.disabled) { f.releaseAll(); await save; return; }
  ta.value = 'a edited, plus a typo fix';
  f.releaseAll(); await save; await settle();
  if (!(w.editor() && w.editor().value === 'a edited, plus a typo fix' && w.app.editing)) throw new Error('box was editable during the save and the extra text is gone; screen: ' + w.screen());
});

test('a save that succeeds is never left as a dead editor when the follow-up reload fails', async function () {
  const tree = { 'Home.md': page('v1'), 'Other.md': page('o') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'v2';
  f.ctl.failOnce.add('Other.md');
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

for (const viaBanner of [false, true]) {
  test('a colleague re-saving the page as non-UTF-8 is never overwritten' + (viaBanner ? ' (banner, Merge, then Save)' : ' (Save)'), async function () {
    const tree = { 'Home.md': page('title\n\ncafe\n') }; const f = fakeFolder('A', tree);
    const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
    await w.app.openEditor(); w.editor().value = 'my title\n\ncafe\n';
    tree['Home.md'] = page(Buffer.from('title\n\ncaf\xE9\n', 'latin1'));
    if (viaBanner) { await w.app.pollLive(); w.app.mergeIncoming(); }
    await w.app.saveEditor();
    const bad = [];
    check(bad, tree['Home.md'].bytes.includes(0xE9), 'their byte was replaced: ' + tree['Home.md'].bytes.toString('hex'));
    check(bad, w.app.editing && w.editor(), 'the editor closed');
    check(bad, /UTF-8/.test(w.msg() || ''), 'message: ' + w.msg());
    if (bad.length) throw new Error(bad.join('\n  '));
  });
}

test('saving a page that is not UTF-8 does not destroy the characters it could not decode', async function () {
  const legacy = Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x0A]);
  const tree = { 'Legacy.md': page(legacy) }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Legacy' }); await w.app.start(f.root);
  await w.app.openEditor();
  if (w.editor()) { w.editor().value += 'one more line\n'; await w.app.saveEditor(); }
  if (!tree['Legacy.md'].bytes.includes(0xE9)) throw new Error('bytes on disk: ' + tree['Legacy.md'].bytes.toString('hex') + ' (e9 became ef bf bd)');
});

function t(name, fn) { test(name, async function () { const bad = await fn(); if (bad.length) throw new Error(bad.join('\n  ')); }); }
function gateStamp(f) {
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

t('a save refused by a clash leaves Cancel usable and unlocks the box once the clash is decided', async function () {
  const tree = { 'A.md': page('a') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'mine';
  tree['A.md'] = page('theirs'); await w.app.saveEditor();
  const bad = [];
  check(bad, w.env.el('editCancel').disabled === false, 'Cancel disabled while choosing');
  w.app.pickConflict(0, 'theirs');
  check(bad, w.editor() && w.editor().readOnly === false, 'textarea still read-only');
  check(bad, w.env.el('editSave').disabled === false && w.env.el('editCancel').disabled === false, 'buttons still disabled');
  check(bad, w.app.editing && w.app.editing.saving === false, 'saving flag still set');
  return bad;
});

t('a write that throws unlocks the editor and says so', async function () {
  const tree = { 'A.md': page('a') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'mine';
  f.ctl.failOnce.add('A.md');
  await w.app.saveEditor();
  const bad = [];
  check(bad, w.editor() && w.editor().value === 'mine' && w.editor().readOnly === false, 'editor lost or locked');
  check(bad, /^Could not save/.test(w.msg() || ''), 'message: ' + w.msg());
  check(bad, textOf(tree['A.md']) === 'a', 'disk: ' + textOf(tree['A.md']));
  await w.app.saveEditor();
  check(bad, textOf(tree['A.md']) === 'mine', 'retry did not write; disk: ' + textOf(tree['A.md']));
  return bad;
});

t('leaving during the write does not throw (lockEditor is not called on a missing editor) and the save is picked up by the next poll', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a edited';
  f.ctl.holdWrite.add('A.md');
  const save = w.app.saveEditor(); await settle();
  w.go('#B');
  f.releaseAll(); await save; await settle();
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
  const hold = gateStamp(f); hold.on = true;
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

t('loading is released after a failed stamp check and after a failed reload', async function () {
  const tree = { 'Home.md': page('v1'), 'Other.md': page('o') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  const orig = f.root.values.bind(f.root); let boom = 1;
  f.root.values = async function* () { if (boom-- > 0) throw new Error('NetworkError'); yield* orig(); };
  await w.app.pollLive();
  tree['Home.md'] = page('v2'); f.ctl.failOnce.add('Other.md');
  await w.app.pollLive();
  const ok = await w.app.forceRefresh();
  const bad = [];
  check(bad, ok === true, 'refresh returned ' + ok);
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
  const r = w.app.forceRefresh(); await settle();
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder();
  const bad = [];
  check(bad, w.screen().includes('B home'), 'right after the switch: ' + w.screen());
  a.releaseAll(); await r; await settle();
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
  const treeB = { 'Home.md': page('same') }; treeB['Home.md'].modified = treeA['Home.md'].modified; const b = fakeFolder('B', treeB);
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
  const r = w.app.forceRefresh(); await settle();
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

function pause(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
function holdFirstWalk(f) {
  const orig = f.root.values.bind(f.root); const g = { armed: true, waiters: [], walks: 0 };
  f.root.values = async function* () { g.walks++; const held = g.armed; g.armed = false; yield* orig(); if (held) await new Promise(function (r) { g.waiters.push(r); }); };
  g.release = function () { g.waiters.splice(0).forEach(function (r) { r(); }); };
  return g;
}
function copyOf(tree) { const c = {}; Object.keys(tree).forEach(function (k) { c[k] = { bytes: tree[k].bytes, modified: tree[k].modified }; }); return c; }

t('an Edit read of folder A that finishes after a switch to an identical copy B opens no editor and writes nothing into B', async function () {
  const treeA = { 'Home.md': page('same') }; const a = fakeFolder('A', treeA);
  const treeB = copyOf(treeA); const b = fakeFolder('B', treeB);
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  a.ctl.hold.add('Home.md');
  const open = w.app.openEditor(); await settle();
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder();
  a.releaseAll(); await open; await settle();
  const bad = [];
  check(bad, !w.editor(), 'topbar says ' + w.env.label + ', and an editor opened from the read of folder A');
  if (w.editor()) { w.editor().value = 'typed after the switch'; await w.app.saveEditor(); }
  check(bad, textOf(treeB['Home.md']) === 'same', 'B/Home.md on disk is now ' + JSON.stringify(textOf(treeB['Home.md'])) + '; A/Home.md is ' + JSON.stringify(textOf(treeA['Home.md'])));
  return bad;
});

t('an older, slower folder pick that finishes after a newer pick does not take over or close the draft', async function () {
  const a = fakeFolder('A', { 'Home.md': page('A home') });
  const treeB = { 'Home.md': page('B home') }; const b = fakeFolder('B', treeB);
  const treeC = { 'Home.md': page('C home') }; const c = fakeFolder('C', treeC);
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  b.ctl.hold.add('Home.md');
  w.env.pick = async function () { return b.root; };
  const slow = w.app.chooseFolder(); await settle();
  w.env.pick = async function () { return c.root; };
  await w.app.chooseFolder();
  await w.app.openEditor();
  const bad = [];
  check(bad, !!w.editor(), 'could not open an editor in C');
  if (w.editor()) w.editor().value = 'draft C';
  b.releaseAll(); await slow; await settle();
  check(bad, w.app.handle === 'C' && w.env.label === 'C', 'folder is now ' + w.app.handle + ', topbar says ' + w.env.label);
  check(bad, w.editor() && w.editor().value === 'draft C', 'draft: ' + (w.editor() ? w.editor().value : 'gone; screen ' + w.screen()));
  return bad;
});

t('with no editor open, the newer pick still wins', async function () {
  const a = fakeFolder('A', { 'Home.md': page('A home') });
  const b = fakeFolder('B', { 'Home.md': page('B home') });
  const c = fakeFolder('C', { 'Home.md': page('C home') });
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  b.ctl.hold.add('Home.md');
  w.env.pick = async function () { return b.root; };
  const slow = w.app.chooseFolder(); await settle();
  w.env.pick = async function () { return c.root; };
  await w.app.chooseFolder();
  b.releaseAll(); await slow; await settle();
  return w.app.handle === 'C' && w.screen().includes('C home') ? [] : ['folder ' + w.app.handle + ', screen ' + w.screen()];
});

t('a slow folder pick that lands after the user started a draft does not close the draft', async function () {
  const treeA = { 'Home.md': page('A home') }; const a = fakeFolder('A', treeA);
  const b = fakeFolder('B', { 'Home.md': page('B home') });
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  b.ctl.hold.add('Home.md');
  w.env.pick = async function () { return b.root; };
  const slow = w.app.chooseFolder(); await settle();
  await w.app.openEditor(); w.editor().value = 'draft A';
  b.releaseAll(); await slow; await settle();
  const bad = [];
  check(bad, w.editor() && w.editor().value === 'draft A', 'draft: ' + (w.editor() ? w.editor().value : 'gone; screen ' + w.screen()));
  if (w.editor()) await w.app.saveEditor();
  check(bad, textOf(treeA['Home.md']) === 'draft A', 'A/Home.md: ' + textOf(treeA['Home.md']));
  return bad;
});

t('the folder button does not throw away an open draft', async function () {
  const treeA = { 'Home.md': page('A home') }; const a = fakeFolder('A', treeA);
  const treeB = { 'Home.md': page('B home') }; const b = fakeFolder('B', treeB);
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  await w.app.openEditor(); w.editor().value = 'draft A';
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder(); await settle();
  const bad = [];
  check(bad, w.editor() && w.editor().value === 'draft A', 'draft: ' + (w.editor() ? w.editor().value : 'gone; screen ' + w.screen()));
  check(bad, w.app.handle === 'A', 'folder is now ' + w.app.handle);
  return bad;
});

t('a save in folder B finishes while a reload of the old folder A is still stalled', async function () {
  const a = fakeFolder('A', { 'Home.md': page('A home'), 'Slow.md': page('s') });
  const treeB = { 'Home.md': page('B home') }; const b = fakeFolder('B', treeB);
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  a.ctl.hold.add('Slow.md');
  const r = w.app.forceRefresh(); await settle();
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder();
  await w.app.openEditor(); w.editor().value = 'B edited';
  const s = w.app.saveEditor(); await settle(); await pause(250); await settle();
  const bad = [];
  check(bad, textOf(treeB['Home.md']) === 'B edited', 'disk: ' + textOf(treeB['Home.md']));
  check(bad, !w.editor() && w.screen().includes('| B edited'), 'file is written, but ' + (w.editor() ? 'the editor is still locked on ' + JSON.stringify(w.msg()) : 'screen shows ' + w.screen()));
  a.releaseAll(); await r; await s; await settle();
  check(bad, w.screen().includes('| B edited') && w.app.handle === 'B', 'after A settled: folder ' + w.app.handle + ', screen ' + w.screen());
  return bad;
});

t('a save finishes while an earlier reload of the same folder is stuck on another file', async function () {
  const tree = { 'Home.md': page('v1'), 'Stuck.md': page('s') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  f.ctl.hold.add('Stuck.md');
  const r = w.app.forceRefresh(); await settle();
  await w.app.openEditor(); w.editor().value = 'v2';
  const s = w.app.saveEditor(); await settle(); await pause(250); await settle();
  const bad = [];
  check(bad, textOf(tree['Home.md']) === 'v2', 'disk: ' + textOf(tree['Home.md']));
  check(bad, !w.editor() && w.screen().includes('| v2'), 'file is written, but ' + (w.editor() ? 'the editor is still locked on ' + JSON.stringify(w.msg()) : 'screen shows ' + w.screen()));
  f.releaseAll(); await r; await s; await settle();
  check(bad, w.screen().includes('| v2'), 'after the stuck read settled: ' + w.screen());
  return bad;
});

t('Save shows the saved text even when every folder read fails afterwards', async function () {
  const tree = { 'Home.md': page('v1'), 'Other.md': page('o') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = '---\ntitle: New\ntags: t9\n---\nv2';
  f.ctl.failAlways.add('Other.md');
  await w.app.saveEditor(); await settle();
  const bad = [];
  check(bad, !w.editor() && w.screen().includes('title=New | tags=t9 | v2'), 'screen: ' + w.screen());
  f.ctl.failAlways.clear(); await w.app.pollLive();
  check(bad, w.screen().includes('title=New | tags=t9 | v2') && w.app.pages.Other.content === 'o', 'after a healthy poll: ' + w.screen());
  return bad;
});

t('Save keeps the other pages\' titles and tags (the index is rebuilt from source, not from stripped bodies)', async function () {
  const tree = { 'Home.md': page('v1'), 'Fancy.md': page('---\ntitle: Fancy\ntags: t1\n---\nbody') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'v2'; await w.app.saveEditor();
  const p = w.app.pages.Fancy;
  return p && p.title === 'Fancy' && p.tags.join() === 't1' && p.content === 'body' ? [] : ['Fancy is now ' + JSON.stringify(p && { title: p.title, tags: p.tags, content: p.content })];
});

t('after a read that never settles, the refresh button still reloads', async function () {
  const tree = { 'Home.md': page('v1'), 'Stuck.md': page('s') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  f.ctl.hold.add('Stuck.md');
  const r = w.app.forceRefresh(); await settle();
  f.ctl.hold.delete('Stuck.md');
  tree['Home.md'] = page('their v2');
  const ok = await w.app.forceRefresh();
  const bad = [];
  check(bad, ok === true && w.screen().includes('their v2'), 'refresh returned ' + ok + ', screen: ' + w.screen());
  await w.app.pollLive();
  tree['Home.md'] = page('their v3'); await w.app.pollLive();
  check(bad, w.screen().includes('their v3'), 'polls after that: ' + w.screen());
  f.releaseAll(); await r; await settle();
  check(bad, w.screen().includes('their v3'), 'after the stuck read finally settled: ' + w.screen());
  return bad;
});

t('the refresh button pressed during a poll\'s stamp check reloads, and the overtaken poll does nothing more', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  const g = holdFirstWalk(f);
  const p = w.app.pollLive(); await settle();
  tree['Home.md'].bytes = Buffer.from('their v2');
  const ok = await w.app.forceRefresh();
  const bad = [];
  check(bad, ok === true && w.screen().includes('their v2'), 'refresh returned ' + ok + ', screen: ' + w.screen());
  const walks = g.walks;
  g.release(); await p; await settle();
  check(bad, g.walks === walks, 'the overtaken poll started ' + (g.walks - walks) + ' more folder walk(s)');
  return bad;
});

t('polls do not pile up behind a slow stamp check', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  const g = holdFirstWalk(f);
  const p1 = w.app.pollLive(); await settle();
  await w.app.pollLive(); await w.app.pollLive();
  const bad = [];
  check(bad, g.walks === 1, 'folder walks started: ' + g.walks);
  g.release(); await p1; await settle();
  tree['Home.md'] = page('v2'); await w.app.pollLive();
  check(bad, w.screen().includes('| v2'), 'polling did not resume: ' + w.screen());
  return bad;
});

t('a save whose user walked away is in the index as soon as the write lands, with no poll', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a edited';
  f.ctl.holdWrite.add('A.md');
  const save = w.app.saveEditor(); await settle();
  w.go('#B');
  f.releaseAll(); await save; await settle();
  const bad = [];
  check(bad, w.screen().startsWith('PAGE B'), 'screen: ' + w.screen());
  w.go('#A');
  check(bad, w.screen().includes('| a edited'), 'back on A without a poll: ' + w.screen());
  return bad;
});

t('a save that lands while the user drafts another page leaves that draft alone', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'a edited';
  f.ctl.holdWrite.add('A.md');
  const save = w.app.saveEditor(); await settle();
  w.go('#B'); await w.app.openEditor(); w.editor().value = 'draft B';
  f.releaseAll(); await save; await settle();
  const bad = [];
  check(bad, w.editor() && w.editor().value === 'draft B' && w.app.editing.slug === 'B', 'B draft: ' + (w.editor() ? w.editor().value : 'gone; screen ' + w.screen()));
  await w.app.saveEditor();
  check(bad, textOf(tree['A.md']) === 'a edited' && textOf(tree['B.md']) === 'draft B', 'disk: A=' + textOf(tree['A.md']) + ' B=' + textOf(tree['B.md']));
  return bad;
});

t('a reload that read the page before Save never puts the old text back, even after the user passed through another editor', async function () {
  const tree = { 'Home.md': page('v1'), 'Slow.md': page('s'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  f.ctl.hold.add('Slow.md');
  const r = w.app.forceRefresh(); await settle();
  await w.app.openEditor(); w.editor().value = 'v2';
  f.ctl.holdWrite.add('Home.md');
  const s = w.app.saveEditor(); await settle();
  w.go('#B'); await w.app.openEditor();
  f.ctl.holdWrite.clear(); f.ctl.pendingWrites.splice(0).forEach(function (x) { x(); }); await s; await settle();
  w.go('#Home');
  f.releaseAll(); await r; await settle();
  return w.screen().includes('| v2') ? [] : ['screen: ' + w.screen()];
});

t('a refresh (button, focus, Cancel) during a slow folder pick does not cancel the pick', async function () {
  const a = fakeFolder('A', { 'Home.md': page('A home') });
  const b = fakeFolder('B', { 'Home.md': page('B home') });
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  b.ctl.hold.add('Home.md');
  w.env.pick = async function () { return b.root; };
  const slow = w.app.chooseFolder(); await settle();
  const r = await w.app.forceRefresh(); await w.app.pollLive();
  b.releaseAll(); await slow; await settle();
  return r === false && w.app.handle === 'B' && w.screen().includes('B home') ? [] : ['refresh returned ' + r + ', folder ' + w.app.handle + ', screen ' + w.screen()];
});

t('a save in A while a pick of B is loading writes A, shows the saved text, and B still arrives', async function () {
  const treeA = { 'Home.md': page('A home') }; const a = fakeFolder('A', treeA);
  const treeB = { 'Home.md': page('B home') }; const b = fakeFolder('B', treeB);
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  await w.app.openEditor(); w.editor().value = 'A edited';
  a.ctl.holdWrite.add('Home.md');
  const s = w.app.saveEditor(); await settle();
  w.go('#Home');
  b.ctl.hold.add('Home.md');
  w.env.pick = async function () { return b.root; };
  const slow = w.app.chooseFolder(); await settle();
  a.releaseAll(); await s; await settle();
  const bad = [];
  check(bad, textOf(treeA['Home.md']) === 'A edited' && textOf(treeB['Home.md']) === 'B home', 'disk: A=' + textOf(treeA['Home.md']) + ' B=' + textOf(treeB['Home.md']));
  b.releaseAll(); await slow; await settle();
  check(bad, w.app.handle === 'B' && w.screen().includes('B home'), 'folder ' + w.app.handle + ', screen ' + w.screen());
  return bad;
});

t('a save of A/Home that lands after a switch to B does not put A\'s text into B\'s index', async function () {
  const treeA = { 'Home.md': page('A home') }; const a = fakeFolder('A', treeA);
  const treeB = { 'Home.md': page('B home') }; const b = fakeFolder('B', treeB);
  const w = makeApp({ hash: '#Home' }); await w.app.start(a.root);
  await w.app.openEditor(); w.editor().value = 'A edited';
  a.ctl.holdWrite.add('Home.md');
  const s = w.app.saveEditor(); await settle();
  w.go('#Home');
  w.env.pick = async function () { return b.root; };
  await w.app.chooseFolder();
  a.releaseAll(); await s; await settle();
  w.go('#Home');
  const bad = [];
  check(bad, textOf(treeA['Home.md']) === 'A edited' && textOf(treeB['Home.md']) === 'B home', 'disk: A=' + textOf(treeA['Home.md']) + ' B=' + textOf(treeB['Home.md']));
  check(bad, w.screen().includes('B home'), 'screen: ' + w.screen());
  return bad;
});

function sidebarHtml(shown, hash) {
  const tree = { innerHTML: '' };
  const fn = grab('taggedSlugs') + grab('renderSidebar');
  const f = (0, eval)('(function (tree, location, shownPage) { const PAGES = { "guides/setup": { folder: "guides", tags: [], title: "Setup" }, Home: { folder: "", tags: [], title: "Home" } }; const activeTag = "", landingPage = "", foldersOpen = false, sidebarOrder = "files"; function el() { return tree; } function escapeHtml(s) { return s; } function titleOf(s) { return PAGES[s].title; } function markActive() {} ' + fn + ' renderSidebar(); })');
  f(tree, { hash: hash }, shown);
  return tree.innerHTML;
}
t('a redraw after a footnote click keeps the shown page\'s folder open in the sidebar', async function () {
  const before = sidebarHtml('guides/setup', '#guides%2Fsetup'); const after = sidebarHtml('guides/setup', '#fn-1');
  const bad = [];
  check(bad, /<details class="grp" open>/.test(before), 'baseline sidebar: ' + before);
  check(bad, /<details class="grp" open>/.test(after), 'with #fn-1 in the address bar: ' + after);
  return bad;
});

t('a save that returns after someone else overwrote the page and a reload showed it: the next poll shows theirs', async function () {
  const tree = { 'A.md': page('a'), 'B.md': page('b') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#A' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'mine';
  const orig = f.root.getFileHandle.bind(f.root); let release = null;
  f.root.getFileHandle = async function (n) {
    const fh = await orig(n); const get = fh.getFile.bind(fh); let calls = 0;
    fh.getFile = async function () { if (++calls === 2) await new Promise(function (res) { release = res; }); return get(); };
    return fh;
  };
  const s = w.app.saveEditor(); await settle();
  const bad = [];
  check(bad, textOf(tree['A.md']) === 'mine' && typeof release === 'function', 'setup: the write should be on disk with saveFile still waiting; disk ' + textOf(tree['A.md']));
  f.root.getFileHandle = orig;
  w.go('#B');
  tree['A.md'].bytes = Buffer.from('theirs'); tree['A.md'].modified = ++clock;
  const ok = await w.app.forceRefresh();
  check(bad, ok === true && w.app.pages.A.content === 'theirs', 'setup: the reload should show theirs; refresh ' + ok + ', index ' + w.app.pages.A.content);
  release(); await s; await settle();
  await w.app.pollLive(); await w.app.pollLive();
  w.go('#A');
  check(bad, w.screen().includes('| theirs'), 'disk has ' + JSON.stringify(textOf(tree['A.md'])) + ' but after two polls the screen shows: ' + w.screen());
  return bad;
});

t('the only page is saved, then someone removes it: the next polls stop showing it', async function () {
  const tree = { 'Home.md': page('v1') }; const f = fakeFolder('A', tree);
  const w = makeApp({ hash: '#Home' }); await w.app.start(f.root);
  await w.app.openEditor(); w.editor().value = 'v2'; await w.app.saveEditor();
  delete tree['Home.md'];
  await w.app.pollLive(); await w.app.pollLive();
  return w.screen().startsWith('NOTFOUND') ? [] : ['the folder is empty but after two polls the screen shows: ' + w.screen()];
});

(async function () {
  let bad = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (e) { bad++; console.log('FAIL: ' + name + '\n  ' + e.message); }
  }
  console.log('test-live: ' + (tests.length - bad) + '/' + tests.length + ' passed');
  process.exit(bad ? 1 : 0);
})();
