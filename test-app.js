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
const total = themeCases.length + schemeCases.length + cases.length + pathCases.length + extCases.length + markCases.length + keyCases.length;
if (bad) { console.log(bad + ' failed'); process.exit(1); }
console.log('test-app: ' + total + '/' + total + ' passed');
