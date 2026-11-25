'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
const out = path.join(tmp, 'index-all.html');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const indexBefore = read('index.html');
execFileSync(process.execPath, [path.join(__dirname, 'bundle.js'), out], { stdio: 'inherit' });
const html = fs.readFileSync(out, 'utf8');

let bad = 0, total = 0;
function check(name, ok) { total++; if (!ok) { bad++; console.log('FAIL: ' + name); } }

const scriptSrcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
check('only data.js is loaded by src, got ' + JSON.stringify(scriptSrcs), JSON.stringify(scriptSrcs) === '["data.js"]');
check('no stylesheet links remain', !/<link\b[^>]*rel="stylesheet"/.test(html));
check('no katex font file urls remain', !/url\(fonts\//.test(html));
check('katex fonts are embedded', /url\(data:font\/woff2;base64,/.test(html));

const inlined = ['app.js', 'config.js', 'vendor/markdown-it.min.js', 'vendor/mdit-extras.js', 'vendor/katex/katex.min.js',
  'vendor/katex/contrib-auto-render.min.js', 'vendor/highlight.min.js', 'vendor/mermaid.min.js', 'vendor/easymde.min.js',
  'style.css', 'user.css', 'vendor/highlight.css', 'vendor/easymde.min.css'];
for (const f of inlined) check(f + ' is inlined verbatim', html.includes(read(f)));

check('bundling leaves index.html untouched', read('index.html') === indexBefore);

const copy = path.join(tmp, 'repo');
fs.cpSync(__dirname, copy, { recursive: true, filter: f => !f.includes(path.sep + '.git') && !f.endsWith('KaTeX_AMS-Regular.woff2') });
let missingFont = null;
try { execFileSync(process.execPath, [path.join(copy, 'bundle.js'), path.join(tmp, 'broken.html')], { stdio: 'pipe' }); }
catch (e) { missingFont = e.stderr.toString(); }
check('a font with no file to embed fails the bundle', missingFont !== null && missingFont.includes('KaTeX_AMS-Regular'));
fs.rmSync(tmp, { recursive: true, force: true });

if (bad) { console.log(bad + ' failed'); process.exit(1); }
console.log('test-bundle: ' + total + '/' + total + ' passed');
