'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const out = path.resolve(process.argv[2] || path.join(root, 'index-all.html'));
const FONTS = { woff2: { type: 'font/woff2', format: 'woff2' }, woff: { type: 'font/woff', format: 'woff' }, ttf: { type: 'font/ttf', format: 'truetype' } };

function source(file, closingTag) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (text.toLowerCase().includes(closingTag)) throw new Error(file + ' contains ' + closingTag + ', so it cannot be inlined');
  return text;
}

function embedFonts(css, cssFile) {
  const dir = path.dirname(path.join(root, cssFile));
  return css.replace(/(,?)url\(([^)"']+)\) format\("[^"]+"\)/g, (whole, comma, url) => {
    const file = path.join(dir, url);
    const font = FONTS[path.extname(url).slice(1)];
    if (!font || !fs.existsSync(file)) return '';
    return comma + 'url(data:' + font.type + ';base64,' + fs.readFileSync(file).toString('base64') + ') format("' + font.format + '")';
  });
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (whole, file) => '<style>' + embedFonts(source(file, '</style'), file) + '</style>')
  .replace(/<script src="([^"]+)"><\/script>/g, (whole, file) => file === 'data.js' ? whole : '<script>' + source(file, '</script') + '</script>');

fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + ' KB)');
