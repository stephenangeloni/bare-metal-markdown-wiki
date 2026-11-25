'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-'));
const repo = path.join(tmp, 'repo');
const git = (...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const appendTo = (file, text) => fs.appendFileSync(path.join(repo, file), text);

let bad = 0, total = 0;
function check(name, ok) { total++; if (!ok) { bad++; console.log('FAIL: ' + name); } }

function bundleOf(commit) {
  const dir = fs.mkdtempSync(path.join(tmp, 'tree-'));
  execFileSync('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', commit, dir], { cwd: repo });
  execFileSync(process.execPath, [path.join(dir, 'bundle.js'), path.join(dir, 'expected.html')], { stdio: 'ignore' });
  return fs.readFileSync(path.join(dir, 'expected.html'), 'utf8');
}
const committed = commit => git('show', commit + ':index-all.html');

fs.cpSync(__dirname, repo, { recursive: true, filter: f => !f.startsWith(path.join(__dirname, '.git' + path.sep)) && f !== path.join(__dirname, '.git') && f !== path.join(__dirname, 'index-all.html') });
git('init', '-q', '-b', 'main');
git('config', 'core.hooksPath', '.githooks');
git('add', '-A');
git('commit', '-q', '-m', 'initial');
check('the first commit gets an up-to-date index-all.html', committed('HEAD') === bundleOf('HEAD'));

appendTo('app.js', '\n;window.hookTestStaged = 1;\n');
git('add', 'app.js');
appendTo('app.js', '\n;window.hookTestUnstaged = 1;\n');
git('commit', '-q', '-m', 'partly staged app.js');
check('a commit rebuilds index-all.html from the staged files', committed('HEAD') === bundleOf('HEAD'));
check('unstaged edits stay out of the committed index-all.html', !committed('HEAD').includes('hookTestUnstaged'));
git('checkout', '-q', '--', 'app.js');

appendTo('app.js', '\n;window.hookTestPartial = 1;\n');
appendTo('README.md', '\npartial\n');
git('add', 'README.md');
const before = git('rev-parse', 'HEAD');
let refused = '';
try { git('commit', '-q', '-m', 'partial', 'app.js'); } catch (e) { refused = e.stderr; }
check('a partial commit that changes index-all.html is refused', refused.includes('git commit without paths') && git('rev-parse', 'HEAD') === before);
git('checkout', '-q', 'HEAD', '--', 'app.js', 'README.md');
appendTo('articles/Home.md', '\npartial\n');
appendTo('README.md', '\npartial\n');
git('add', 'README.md');
git('commit', '-q', '-m', 'partial article', 'articles/Home.md');
check('a partial commit that leaves index-all.html alone goes through', git('log', '-1', '--format=%s') === 'partial article\n');
git('checkout', '-q', 'HEAD', '--', 'README.md');

git('checkout', '-q', '-b', 'side');
appendTo('style.css', '\n.hook-test-side{}\n');
git('commit', '-q', '-am', 'side style');
git('checkout', '-q', 'main');
appendTo('config.js', '\n;window.hookTestMain = 1;\n');
git('commit', '-q', '-am', 'main config');
let conflicted = false;
try { git('merge', '-q', '--no-edit', 'side'); } catch (e) {
  conflicted = git('diff', '--name-only', '--diff-filter=U') === 'index-all.html\n';
  git('checkout', '--theirs', '--', 'index-all.html');
  git('add', 'index-all.html');
  git('commit', '-q', '--no-edit');
}
check('a merge where both sides changed it stops on index-all.html alone', conflicted);
const merged = committed('HEAD');
check('a merge commit gets an index-all.html with both sides', merged === bundleOf('HEAD') && merged.includes('hook-test-side') && merged.includes('hookTestMain'));

fs.rmSync(tmp, { recursive: true, force: true });
if (bad) { console.log(bad + ' failed'); process.exit(1); }
console.log('test-hook: ' + total + '/' + total + ' passed');
