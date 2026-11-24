'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

module.exports = function grab(name) {
  const c = new RegExp('^\\s*const ' + name + ' = .*;$', 'm').exec(src);
  if (c) return c[0].trim();
  const m = new RegExp('(async )?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('app.js: ' + name + ' not found');
  let d = 0;
  for (let j = m.index; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
};
