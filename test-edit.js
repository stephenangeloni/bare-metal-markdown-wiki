'use strict';


const grab = require('./test-grab.js');
const api = (0, eval)('(function () { const imgExtRe = /\\.png$/i;' + ['fileAt', 'versionOf', 'readForEdit', 'saveFile', 'folderStamp', 'splitLines', 'matchLines', 'merge3'].map(grab).join('\n') +
  '\nreturn { readForEdit: readForEdit, saveFile: saveFile, folderStamp: folderStamp, merge3: merge3 }; })()');

let clock = Date.now();
function fakeFolder(tree) {
  function dir(node) {
    return {
      kind: 'directory',
      async getDirectoryHandle(name) { if (!node[name] || typeof node[name].text === 'string') throw new Error('NotFoundError'); return dir(node[name]); },
      async getFileHandle(name, opts) {
        if (!node[name]) { if (!opts || !opts.create) throw new Error('NotFoundError'); node[name] = page(''); }
        return file(node[name], name);
      },
      async removeEntry(name) { if (!node[name]) throw new Error('NotFoundError'); delete node[name]; },
      async *values() { for (const k of Object.keys(node)) { if (!node[k]) continue; yield typeof node[k].text === 'string' ? file(node[k], k) : Object.assign(dir(node[k]), { name: k }); } }
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

function merged(parts) { return parts.map(function (p) { return p.conflict ? '<' + p.theirs + '|' + p.mine + '>' : p.text; }).join(''); }

test('merges their change and mine when they touch different lines', function () {
  const base = 'title\nintro\nmiddle\nend\n';
  const mine = 'title\nintro, rewritten by me\nmiddle\nend\n';
  const theirs = 'title\nintro\nmiddle\nend\nnew closing line\n';
  eq(merged(api.merge3(base, mine, theirs)), 'title\nintro, rewritten by me\nmiddle\nend\nnew closing line\n', 'merged text');
});

test('reports a conflict when we both changed the same line, and merges the rest', function () {
  const parts = api.merge3('a\nb\nc\nd\n', 'a\nb\nc mine\nd\n', 'A\nb\nc theirs\nd\n');
  eq(merged(parts), 'A\nb\n<c theirs\n|c mine\n>d\n', 'merged text with the conflict marked');
});

test('changes on neighbouring lines count as one overlap, as in git', function () {
  eq(merged(api.merge3('a\nb\nc\n', 'a mine\nb\nc\n', 'a\nb theirs\nc\n')), '<a\nb theirs\n|a mine\nb\n>c\n', 'merged text');
});

test('the same change made by both of us is not a conflict', function () {
  eq(merged(api.merge3('a\nb\n', 'a\nB\n', 'a\nB\n')), 'a\nB\n', 'merged text');
});

test('both adding different lines at the same place is a conflict', function () {
  eq(merged(api.merge3('a\nz\n', 'a\nmine\nz\n', 'a\ntheirs\nz\n')), 'a\n<theirs\n|mine\n>z\n', 'merged text');
});

test('a line they deleted stays deleted when I did not touch it', function () {
  eq(merged(api.merge3('a\nb\nc\nd\n', 'a\nb\nc\nd mine\n', 'a\nc\nd\n')), 'a\nc\nd mine\n', 'merged text');
});

test('a last line without a newline merges like any other', function () {
  eq(merged(api.merge3('a\nb\nc', 'a mine\nb\nc', 'a\nb\nc theirs')), 'a mine\nb\nc theirs', 'merged text');
});

test('merges into an empty page and from an empty page', function () {
  eq(merged(api.merge3('', 'mine\n', '')), 'mine\n', 'I wrote a new page');
  eq(merged(api.merge3('x\n', 'x\n', '')), '', 'they emptied the page');
});

test('lines we both changed the same way stay out of the clash', function () {
  eq(merged(api.merge3('Old title\nold body\n', 'New title\nmine\n', 'New title\ntheirs\n')), 'New title\n<theirs\n|mine\n>', 'merged text');
});

test('both adding a line to a page with no final newline clashes only on the added lines', function () {
  eq(merged(api.merge3('l1\nl2\nl3\nl4\nl5', 'l1\nl2\nl3\nl4\nl5\nmine', 'l1\nl2\nl3\nl4\nl5\nl6')), 'l1\nl2\nl3\nl4\nl5\n<l6|mine>', 'merged text');
});

test('an edit at the top merges with their line added to a page with no final newline', function () {
  eq(merged(api.merge3('l1\nl2\nl3\nl4\nl5', 'L1\nl2\nl3\nl4\nl5', 'l1\nl2\nl3\nl4\nl5\nl6')), 'L1\nl2\nl3\nl4\nl5\nl6', 'merged text');
});

test('saves an edit into a subfolder file', async function () {
  const tree = { Guides: { 'Basics.md': page('old') } };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Guides/Basics.md');
  eq(opened.text, 'old', 'opened text');
  const r = await api.saveFile(root, 'Guides/Basics.md', 'new text', opened.version);
  eq(r.ok, true, 'saved');
  eq(tree.Guides['Basics.md'].text, 'new text', 'file on disk');
});

test('merges my edit into a file someone else changed meanwhile on other lines', async function () {
  const tree = { 'Home.md': page('title\nintro\nmiddle\nend\n') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  tree['Home.md'] = page('title\nintro\nmiddle\nend\ntheir line\n');
  const r = await api.saveFile(root, 'Home.md', 'title\nmy intro\nmiddle\nend\n', opened.version);
  eq(r.ok, true, 'saved');
  eq(tree['Home.md'].text, 'title\nmy intro\nmiddle\nend\ntheir line\n', 'file on disk');
  eq(r.version.raw, tree['Home.md'].text, 'version kept for the next save');
});

test('merging keeps the Windows line endings of their version', async function () {
  const tree = { 'Home.md': page('a\r\nb\r\nc\r\n') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  tree['Home.md'] = page('a\r\nb\r\nc theirs\r\n');
  await api.saveFile(root, 'Home.md', 'a mine\nb\nc\n', opened.version);
  eq(tree['Home.md'].text, 'a mine\r\nb\r\nc theirs\r\n', 'file on disk');
});

test('a clash on the same lines is not saved and comes back for me to resolve', async function () {
  const tree = { 'Home.md': page('a\nb\nc\n') };
  const root = fakeFolder(tree);
  const opened = await api.readForEdit(root, 'Home.md');
  tree['Home.md'] = page('a\nb theirs\nc\n');
  const r = await api.saveFile(root, 'Home.md', 'a\nb mine\nc\n', opened.version);
  eq(r.ok, false, 'saved');
  eq(tree['Home.md'].text, 'a\nb theirs\nc\n', 'file on disk');
  eq(merged(r.parts), 'a\n<b theirs\n|b mine\n>c\n', 'the clash handed back');
  eq(r.version.raw, 'a\nb theirs\nc\n', 'their version, to resolve against');
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

test('folder stamp ignores the browser temp files written beside a page', async function () {
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
