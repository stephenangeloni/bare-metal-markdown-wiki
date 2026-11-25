'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-')), 'index-all.html');
execFileSync(process.execPath, [path.join(__dirname, 'bundle.js'), out], { stdio: 'inherit' });
const html = fs.readFileSync(out, 'utf8');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

let bad = 0;
function check(name, ok) { if (!ok) { bad++; console.log('FAIL: ' + name); } }

const scriptSrcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
check('only data.js is loaded by src, got ' + JSON.stringify(scriptSrcs), JSON.stringify(scriptSrcs) === '["data.js"]');
check('no stylesheet links remain', !/<link\b[^>]*rel="stylesheet"/.test(html));
check('no katex font file urls remain', !/url\(fonts\//.test(html));
check('katex fonts are embedded', /url\(data:font\/woff2;base64,/.test(html));

const inlined = ['app.js', 'config.js', 'vendor/markdown-it.min.js', 'vendor/mdit-extras.js', 'vendor/katex/katex.min.js',
  'vendor/katex/contrib-auto-render.min.js', 'vendor/highlight.min.js', 'vendor/mermaid.min.js', 'vendor/easymde.min.js',
  'style.css', 'user.css', 'vendor/highlight.css', 'vendor/easymde.min.css'];
for (const f of inlined) check(f + ' is inlined verbatim', html.includes(read(f)));

check('index.html itself is unchanged by bundling', !read('index.html').includes(read('app.js')));

if (bad) { console.log(bad + ' failed'); process.exit(1); }
console.log('test-bundle: ' + (inlined.length + 5) + '/' + (inlined.length + 5) + ' passed');
