'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function grab(name) {
  const i = src.indexOf('async function ' + name);
  if (i < 0) throw new Error('app.js: async function ' + name + ' not found');
  let d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}
const api = (0, eval)('(function () { const imgExtRe = /\\.png$/i;' + ['fileAt', 'readForEdit', 'saveFile', 'folderStamp'].map(grab).join('\n') +
  '\nreturn { readForEdit: readForEdit, saveFile: saveFile, folderStamp: folderStamp }; })()');

let clock = 1000;
function fakeFolder(tree) {
  function dir(node) {
    return {
      kind: 'directory',
      async getDirectoryHandle(name) { if (!node[name] || typeof node[name].text === 'string') throw new Error('NotFoundError'); return dir(node[name]); },
      async getFileHandle(name) { if (!node[name] || typeof node[name].text !== 'string') throw new Error('NotFoundError'); return file(node[name], name); },
      async *values() { for (const k of Object.keys(node)) yield typeof node[k].text === 'string' ? file(node[k], k) : Object.assign(dir(node[k]), { name: k }); }
    };
  }
  function file(f, name) {
    return {
      kind: 'file', name: name,
      async getFile() { return { lastModified: f.modified, text: async function () { return f.text; } }; },
      async createWritable() { let buf = ''; return { write: async function (s) { buf += s; }, close: async function () { f.text = buf; f.modified = ++clock; } }; }
    };
  }
  return dir(tree);
}
function page(text) { return { text: text, modified: ++clock }; }

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function eq(got, want, what) { if (got !== want) throw new Error(what + ': expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got)); }

test('saves an edit into a subfolder file', async function () {
  const tree = { Guides: { 'Basics.md': page('old') } };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Guides/Basics.md');
  eq(opened.text, 'old', 'opened text');
  const r = await api.saveFile(root, 'Guides/Basics.md', 'new text', opened.version);
  eq(r.ok, true, 'saved');
  eq(tree.Guides['Basics.md'].text, 'new text', 'file on disk');
});

test('refuses to save over a file someone else changed meanwhile', async function () {
  const tree = { 'Home.md': page('v1') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  tree['Home.md'] = page('their edit');
  const r = await api.saveFile(root, 'Home.md', 'my edit', opened.version);
  eq(r.ok, false, 'saved');
  eq(tree['Home.md'].text, 'their edit', 'file on disk');
});

test('refuses to save when the content changed but the timestamp did not', async function () {
  const tree = { 'Home.md': page('v1') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  tree['Home.md'].text = 'their edit';
  const r = await api.saveFile(root, 'Home.md', 'my edit', opened.version);
  eq(r.ok, false, 'saved');
  eq(tree['Home.md'].text, 'their edit', 'file on disk');
});

test('a second save after the first one is not a conflict', async function () {
  const tree = { 'Home.md': page('v1') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  const first = await api.saveFile(root, 'Home.md', 'v2', opened.version);
  const second = await api.saveFile(root, 'Home.md', 'v3', first.version);
  eq(second.ok, true, 'second save');
  eq(tree['Home.md'].text, 'v3', 'file on disk');
});

test('keeps Windows line endings of a CRLF file', async function () {
  const tree = { 'Home.md': page('a\r\nb\r\n') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  eq(opened.text, 'a\nb\n', 'text shown in the editor');
  await api.saveFile(root, 'Home.md', 'a\nb\nc\n', opened.version);
  eq(tree['Home.md'].text, 'a\r\nb\r\nc\r\n', 'file on disk');
});

test('keeps Unix line endings of an LF file', async function () {
  const tree = { 'Home.md': page('a\nb\n') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  await api.saveFile(root, 'Home.md', 'a\nb\nc\n', opened.version);
  eq(tree['Home.md'].text, 'a\nb\nc\n', 'file on disk');
});

test('folder stamp changes when a page is edited', async function () {
  const tree = { Guides: { 'Basics.md': page('x') }, 'Home.md': page('y') };
  const root = fakeFolder(tree);
  const before = await api.folderStamp(root);
  eq(await api.folderStamp(root), before, 'stamp with nothing changed');
  tree.Guides['Basics.md'] = page('x2');
  if (await api.folderStamp(root) === before) throw new Error('stamp did not change after an edit');
});

test('folder stamp changes when a page is added or removed', async function () {
  const tree = { 'Home.md': page('y') };
  const root = fakeFolder(tree);
  const before = await api.folderStamp(root);
  tree['New.md'] = page('n');
  const added = await api.folderStamp(root);
  if (added === before) throw new Error('stamp did not change after adding a page');
  delete tree['New.md'];
  eq(await api.folderStamp(root), before, 'stamp after removing the page again');
});

test('folder stamp ignores the browser temp files written during a save', async function () {
  const tree = { 'Home.md': page('y') };
  const root = fakeFolder(tree);
  const before = await api.folderStamp(root);
  tree['Home.md.crswap'] = page('partial');
  eq(await api.folderStamp(root), before, 'stamp with a .crswap file present');
});

(async function () {
  let bad = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (e) { bad++; console.log('FAIL: ' + name + '\n  ' + e.message); }
  }
  console.log('test-edit: ' + (tests.length - bad) + '/' + tests.length + ' passed');
  process.exit(bad ? 1 : 0);
})();
