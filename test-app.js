/* test-app.js — smoke test for app.js source passes (wiki links, footnotes,
   code-run protection). Loads app.js, extracts the functions verbatim, runs them.
   Run: node test-app.js. Exits non-zero on failure. */
'use strict';
global.window = global;

const MarkdownIt = require('./vendor/markdown-it.min.js');
require('./vendor/mdit-extras.js');
const md = new MarkdownIt({ html: true, linkify: true });
global.md = md;

const grab = require('./test-grab.js');
const STEMS = {};
global.STEM = {}; global.PAGES = {};
(0, eval)([grab('escapeHtml'), grab('markHits'), grab('resolveSlug'), grab('outsideCode'), grab('WIKI_LINK_RE'), grab('normalizeParts'), grab('absPath'), grab('extRe'),
           grab('wikiLinks'), grab('withFootnotes'), grab('isSearchShortcut'), grab('usesDarkScheme'), grab('nextTheme')].join('\n') + '\n;global.nextTheme=nextTheme;global.isSearchShortcut=isSearchShortcut;global.usesDarkScheme=usesDarkScheme;global.withFootnotes=withFootnotes;global.wikiLinks=wikiLinks;global.absPath=absPath;global.extRe=extRe;global.markHits=markHits;');
['Home', 'Guides/Basics', 'Guides/Nope'].forEach(function (s) {
  global.PAGES[s] = { slug: s };
  const k = s.split('/').pop().toLowerCase();
  (global.STEM[k] = global.STEM[k] || []).push(s);
});

const cases = [
  ['wiki link in prose',            'go [[Basics|b]]',                               'href="#Guides%2FBasics"'],
  ['stem wins shallower',           '[[Basics]]',                                     '#Guides%2FBasics'],
  ['path form resolves',            '[[Guides/Nope]]',                                '#Guides%2FNope'],
  ['unknown target marked',         '[[Ghost]]',                                      'class="broken-wiki"'],
  ['fence protects wiki links',     'x\n```\n[[Basics]]\n```\ny',                     'code>[[Basics]'],
  ['backtick span protects links',  'see `[[Home]]` here',                            '[[Home]]', '!<span class="broken-wiki">'],
  ['inline backticks inside fence', 'a\n```html\npress `<kbd>x</kbd>` code\n[[Basics]]\n```', '[[Basics]]'],
  ['footnote ref outside code',     'claim.[^a]\n\n[^a]: def',                         '<sup id="fnref-1">'],
  ['footnote def not eaten in fence','```\n[^a]: def\n```\n',                           'code>[^a]: def', '!class="footnotes"'],
  ['footnote ref in fence kept',    '```\n[^a]\n```',                                   '[^a]'],
  ['footnote span outside code',    'see `[^a]` ok',                                   '[^a]', '!<sup id="fnref-'],
];
(async function () {
let bad = 0;
for (const c of cases) {
  const html = withFootnotes(wikiLinks(c[1]));
  const ok = c.slice(2).every(function (s) {
    return s.charAt(0) === '!' ? !html.includes(s.slice(1)) : html.includes(s);
  });
  if (!ok) { bad++; console.log('FAIL: ' + c[0] + '\n  got: ' + html.replace(/\n/g, '\\n')); }
}
const pathCases = [ // image/.md refs resolve against the page's folder
  ['pic.png', 'Guides', 'Guides/pic.png'],
  ['./pic.png', 'Guides', 'Guides/pic.png'],
  ['sub/pic.png', 'Guides', 'Guides/sub/pic.png'],
  ['../shared/x.png', 'Guides', 'shared/x.png'],
  ['/root.png', 'Guides', 'root.png'],
  ['pic.png#frag', 'Guides', 'Guides/pic.png'],
  ['pic.png', '', 'pic.png'],
];
for (const [t, base, want] of pathCases) {
  const got = absPath(t, base);
  if (got !== want) { bad++; console.log('FAIL: absPath ' + JSON.stringify(t) + ' @ ' + JSON.stringify(base) + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
const extCases = [ // imageExts in config.js drives live-render image loading
  ['default list', undefined, ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.svg', 'f.webp'], ['x.txt', 'y.md', 'z.pdf']],
  ['custom list', ['bmp', 'avif'], ['a.bmp', 'b.AVIF'], ['c.png', 'd.jpg']],
  ['junk entries dropped', ['png', 'jpg$|<x'], ['ok.png'], ['a.jpg', 'b.svg']],
];
for (const [name, list, inList, outList] of extCases) {
  const re = extRe(list);
  for (const n of inList) if (!re.test(n)) { bad++; console.log('FAIL: extRe(' + name + ') should match ' + n); }
  for (const n of outList) if (re.test(n)) { bad++; console.log('FAIL: extRe(' + name + ') should NOT match ' + n); }
}
const markCases = [ // searched terms come back <mark>ed in results, query never injects HTML
  ['marks all hits, any case', 'Foo bar BAZ bar', 'bar', 'Foo <mark>bar</mark> BAZ <mark>bar</mark>'],
  ['escapes text and query',   'a<b> a',           'a<b', '<mark>a&lt;b</mark>&gt; a'],
  ['no hit = escaped only',    'x & y',            'zzz', 'x &amp; y'],
];
for (const [name, text, q, want] of markCases) {
  const got = markHits(text, q.toLowerCase());
  if (got !== want) { bad++; console.log('FAIL: markHits ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
const keyCases = [ // Cmd K on a Mac, Ctrl K elsewhere; Ctrl K on a Mac stays the text-field shortcut
  ['mac cmd k',          true,  { metaKey: true, key: 'k' },                 true],
  ['mac cmd K caps',     true,  { metaKey: true, key: 'K' },                 true],
  ['mac ctrl k',         true,  { ctrlKey: true, key: 'k' },                 false],
  ['mac cmd shift k',    true,  { metaKey: true, shiftKey: true, key: 'k' }, false],
  ['mac cmd alt k',      true,  { metaKey: true, altKey: true, key: 'k' },   false],
  ['mac cmd ctrl k',     true,  { metaKey: true, ctrlKey: true, key: 'k' },  false],
  ['other ctrl k',       false, { ctrlKey: true, key: 'k' },                 true],
  ['other meta k',       false, { metaKey: true, key: 'k' },                 false],
  ['other ctrl j',       false, { ctrlKey: true, key: 'j' },                 false],
];
for (const [name, mac, e, want] of keyCases) {
  const got = isSearchShortcut(Object.assign({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, e), mac);
  if (got !== want) { bad++; console.log('FAIL: isSearchShortcut ' + name + ': got ' + got + ', want ' + want); }
}
const schemeCases = [ // the CSS color-scheme value decides, the system setting only when both are allowed
  ['both, system dark',  'light dark', true,  true],
  ['both, system light', 'light dark', false, false],
  ['forced light',       'light',      true,  false],
  ['forced dark',        'dark',       false, true],
  ['normal = light',     'normal',     true,  false],
];
for (const [name, scheme, systemDark, want] of schemeCases) {
  const got = usesDarkScheme(scheme, systemDark);
  if (got !== want) { bad++; console.log('FAIL: usesDarkScheme ' + name + ': got ' + got + ', want ' + want); }
}
const themeCases = [['system', 'light'], ['light', 'dark'], ['dark', 'system']]; // the theme button cycles System → Light → Dark
for (const [from, want] of themeCases) {
  const got = nextTheme(from);
  if (got !== want) { bad++; console.log('FAIL: nextTheme ' + from + ': got ' + got + ', want ' + want); }
}
const sidebarFactory = (0, eval)('(function (env) {\n' +
  'let PAGES = env.pages, FILES = env.files, mode = env.mode, showAllText = env.showAllText, sidebarSort = env.sort, activeTag = "", treeOpen = null, shownPage = env.shown || "", landingPage = "", foldersOpen = false, sidebarOrder = "files";\n' +
  'const out = {}; function el() { return out; } function markActive() {}\n' +
  [grab('escapeHtml'), grab('titleOf'), grab('taggedSlugs'), grab('sidebarOrderSpecs'), grab('offeredOrders'), grab('shownOrder'), grab('renderSidebar')].join('\n') +
  '\nrenderSidebar(); return out.innerHTML; })');
function sidebarFor(sort, opts) {
  opts = opts || {};
  const page = function (slug, title) { return { slug: slug, title: title, folder: slug.indexOf('/') < 0 ? '' : slug.slice(0, slug.lastIndexOf('/')), tags: [] }; };
  const file = function (path, ext) { const cut = path.lastIndexOf('/'); return { key: '/' + path, path: path, folder: cut < 0 ? '' : path.slice(0, cut), name: path.slice(cut + 1), title: path.slice(cut + 1), ext: ext }; };
  const pages = { Home: page('Home', 'Welcome'), 'Guides/Basics': page('Guides/Basics', 'Basics guide'), 'Guides/Advanced': page('Guides/Advanced', 'Zeta') };
  const files = opts.textOff ? {} : { 'Guides/data.csv': file('Guides/data.csv', 'csv'), 'Guides/notes.txt': file('Guides/notes.txt', 'txt'), 'top.js': file('top.js', 'js') };
  const html = sidebarFactory({ pages: pages, files: files, mode: opts.mode || 'live', showAllText: !opts.textOff, sort: sort });
  const items = []; const re = /data-slug="([^"]+)">([^<]*)<|<summary>([^<]*)</g; let m;
  while ((m = re.exec(html))) items.push(m[3] !== undefined ? '[' + m[3] + ']' : m[2]);
  return items.join(' | ');
}
const sidebarCases = [ // [name, sort, options, the sidebar top to bottom: labels, [folder] headings]
  ['by title: pages by title, files by name', 'title', {}, 'top.js | Welcome | [Guides] | Basics guide | data.csv | notes.txt | Zeta'],
  ['by file name', 'name', {}, 'Home.md | top.js | [Guides] | Advanced.md | Basics.md | data.csv | notes.txt'],
  ['by type, within folders', 'type', {}, 'top.js | Home.md | [Guides] | data.csv | Advanced.md | Basics.md | notes.txt'],
  ['grouped by type', 'type-grouped', {}, '[.csv] | Guides/data.csv | [.js] | top.js | [.md] | Guides/Advanced.md | Guides/Basics.md | Home.md | [.txt] | Guides/notes.txt'],
  ['type falls back to title with text files off', 'type', { textOff: true }, 'Welcome | [Guides] | Basics guide | Zeta'],
  ['type falls back to title in bundled mode', 'type-grouped', { textOff: true, mode: 'bundled' }, 'Welcome | [Guides] | Basics guide | Zeta'],
];
for (const [name, sort, opts, want] of sidebarCases) {
  const got = sidebarFor(sort, opts);
  if (got !== want) { bad++; console.log('FAIL: sidebar ' + name + ':\n  got  ' + got + '\n  want ' + want); }
}
const searchFactory = (0, eval)('(function (env) {\n' +
  'let PAGES = env.pages, FILES = env.files, liveHandle = env.root, folderTexts = { folder: null, items: [] };\n' +
  'const WIKI = {}; const els = { searchResults: { innerHTML: "", classList: { add() {}, remove() {} } }, clearSearch: { classList: { toggle() {} } } }; function el(id) { return els[id]; }\n' +
  [grab('escapeHtml'), grab('markHits'), grab('snippet'), grab('intSetting'), grab('heavyTextBytes'), grab('fileAt'), grab('loadFolderTexts'), grab('doSearch')].join('\n') +
  '\nreturn async function (folder, q) { await loadFolderTexts(folder); doSearch(q); return els.searchResults.innerHTML; }; })');
function fakeDir(node) {
  return {
    async getDirectoryHandle(n) { return fakeDir(node[n]); },
    async getFileHandle(n) { return { async getFile() { return { size: node[n].length, async text() { return node[n]; } }; } }; }
  };
}
async function searchIn(folder, q) {
  const disk = { 'top.txt': 'needle at the top', Guides: { 'notes.txt': 'a needle here', 'big.log': 'needle ' + 'x'.repeat(1000001) }, Other: { 'far.txt': 'needle far away' } };
  const file = function (path) { const cut = path.lastIndexOf('/'); return { key: '/' + path, path: path, folder: cut < 0 ? '' : path.slice(0, cut), name: path.slice(cut + 1) }; };
  const pages = { 'Other/Deep': { slug: 'Other/Deep', title: 'Deep', folder: 'Other', haystack: 'deep needle', plain: 'deep needle' } };
  const files = {}; ['top.txt', 'Guides/notes.txt', 'Guides/big.log', 'Other/far.txt'].forEach(function (p) { files['/' + p] = file(p); });
  const html = await searchFactory({ pages: pages, files: files, root: fakeDir(disk) })(folder, q);
  return (html.match(/href="#[^"]+"/g) || []).map(function (h) { return decodeURIComponent(h.slice(7, -1)); }).sort().join(', ');
}
const searchCases = [ // .md pages match from anywhere, other text files only from the folder on screen
  ['Guides folder', 'Guides', '/Guides/notes.txt, Other/Deep'],
  ['root folder', '', '/top.txt, Other/Deep'],
  ['Other folder', 'Other', '/Other/far.txt, Other/Deep'],
];
for (const [name, folder, want] of searchCases) {
  const got = await searchIn(folder, 'needle');
  if (got !== want) { bad++; console.log('FAIL: search ' + name + ': got ' + got + ', want ' + want); }
}
const total = searchCases.length + sidebarCases.length + themeCases.length + schemeCases.length + cases.length + pathCases.length + extCases.length + markCases.length + keyCases.length;
if (bad) { console.log(bad + ' failed'); process.exit(1); }
console.log('test-app: ' + total + '/' + total + ' passed');
})();
