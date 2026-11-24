/* Local Wiki — no server, fully offline after build.
 * Frame = index.html; knowledge = markdown; rendered on the fly.
 * Two loaders: bundled (data.js) always works; live (File System Access) in Chrome/Edge.
 */
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function el(id) { return document.getElementById(id); }
  function usesDarkScheme(scheme, systemDark) { // same rule the browser uses to resolve light-dark() in style.css
    const allowed = scheme.split(' ');
    return allowed.includes('dark') && (systemDark || !allowed.includes('light'));
  }
  function nextTheme(t) { return { system: 'light', light: 'dark', dark: 'system' }[t]; } // the theme button cycles System → Light → Dark
  function isSearchShortcut(e, mac) { // Cmd K on a Mac, Ctrl K elsewhere; Ctrl K on a Mac keeps its text-field meaning (delete to end of line)
    return (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function b64toUtf8(b64) {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return new TextDecoder('utf-8').decode(bytes);
  }
  function titleOf(slug) { return PAGES[slug] ? PAGES[slug].title : slug; }

  // ---------- markdown engine ----------
  const md = window.markdownit({ html: true, linkify: true, typographer: false, breaks: false });
  const defValidateLink = md.validateLink.bind(md); // markdown-it blocks non-http schemes for links AND images; let file:// through (works when the wiki itself runs on file://, browsers block it over http — nothing more we can do)
  md.validateLink = function (u) { return /^file:\/\/\//i.test(u) || defValidateLink(u); };
  if (window.MditExtras) { md.use(MditExtras.container); md.use(MditExtras.alerts); md.use(MditExtras.tabs); md.use(MditExtras.badges); md.use(MditExtras.buttons); } // ::: containers, > [!NOTE] alerts, ::: tabs, @{ badges }, @[button links]
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  function currentMermaidTheme() { return usesDarkScheme(getComputedStyle(document.documentElement).colorScheme, systemDark.matches) ? 'dark' : 'default'; }
  function initMermaid(theme) { if (window.mermaid) { try { mermaid.initialize({ startOnLoad: false, theme: theme }); } catch (e) {} } }
  let mermaidTheme = currentMermaidTheme();
  initMermaid(mermaidTheme);

  // ---------- state ----------
  const WIKI = window.WIKI || {}; // settings live in config.js; every key has a built-in default
  let RAW = [];                 // [{slug, mtime, content}]
  let PAGES = {};               // slug -> {slug,title,folder,tags,mtime,content,links}
  let IMAGES = {};              // "folder/file.png" (KB-root-relative) -> data URI
  let STEM = {};                // lowercased filename stem -> [slugs]
  let mode = 'bundled';
  let activeTag = '';
  let liveHandle = null;       // FileSystemDirectoryHandle, once connected
  let lastRefresh = 0;         // debounce for focus auto-refresh
  let liveStamp = '';
  let editing = null;
  let shownPage = '';
  let loading = null;
  let tocHtml = '';            // current page's TOC, injected into the sidebar or rail
  let tocSide = (WIKI.tocSide === 'right') ? 'right' : 'left'; // from the settings in config.js
  const narrowMq = window.matchMedia('(max-width: 760px)'); // drawer breakpoint — keep in sync with the @media block in style.css
  let tocLevels = Math.min(6, Math.max(1, parseInt(WIKI.tocLevels, 10) || 3)); // TOC heading depth, 1–6
  let foldersOpen = WIKI.foldersOpen === true; // start with the sidebar folders expanded
  let landingPage = typeof WIKI.landingPage === 'string' ? WIKI.landingPage : ''; // page opened at empty hash; '' = generated home
  let sidebarOrder = (WIKI.sidebarOrder === 'folders' || WIKI.sidebarOrder === 'alpha') ? WIKI.sidebarOrder : 'files'; // 'folders' | 'files' | 'alpha'
  document.documentElement.style.setProperty('--page-w', Math.min(100, Math.max(10, parseInt(WIKI.pageWidth, 10) || 70)) + '%'); // article width cap, 10–100%
  document.documentElement.style.setProperty('--search-w', Math.min(100, Math.max(10, parseInt(WIKI.searchWidth, 10) || 50)) + '%'); // search panel width, 10–100% of the window
  document.documentElement.style.setProperty('--search-h', Math.min(100, Math.max(10, parseInt(WIKI.searchHeight, 10) || 60)) + 'vh'); // search panel max height, 10–100% of the window
  const wikiName = (typeof WIKI.wikiName === 'string' && WIKI.wikiName.trim()) ? WIKI.wikiName.trim() : 'Local Wiki'; // shown in topbar + tab titles
  document.querySelector('.brand-name').textContent = wikiName;
  if (typeof WIKI.brandIcon === 'string') { // unset keeps the built-in mark; '' hides it; any other text replaces it
    const mark = document.querySelector('.brand-mark');
    if (WIKI.brandIcon) { mark.textContent = WIKI.brandIcon; mark.classList.add('brand-glyph'); } else mark.remove();
  }
  if (typeof WIKI.favicon === 'string' && WIKI.favicon) el('favicon').href = WIKI.favicon; // custom tab icon: file next to index.html, any URL, or a data: URI
  const expandOnPrint = WIKI.expandOnPrint !== false; // open every fold in the article right before printing, restore after

  // ---------- frontmatter ----------
  function parseFrontmatter(src) {
    const tags = []; let title = ''; let body = src;
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (m) {
      const block = m[1]; body = src.slice(m[0].length);
      const t = block.match(/^title:\s*(.+)$/m);
      if (t) title = t[1].trim().replace(/^["']|["']$/g, '');
      const ti = block.match(/^tags:\s*(.*)$/m);
      if (ti) {
        const inline = ti[1].trim();
        if (inline) tags.push.apply(tags, inline.split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); }).filter(Boolean));
        else { let mm; const list = /^\s*-\s+(.+)$/gm; while ((mm = list.exec(block))) { const v = mm[1].trim().replace(/^["']|["']$/g, ''); if (v) tags.push(v); } }
      }
    }
    return { tags: tags, title: title, body: body };
  }

  // ---------- link resolution ----------
  function normalizeParts(parts) {
    const out = [];
    for (const p of parts) { if (p === '.' || p === '') continue; if (p === '..') out.pop(); else out.push(p); }
    return out;
  }
  function resolveSlug(t) {
    if (t.indexOf('/') !== -1) {
      const s = t.replace(/^\/+/, '').replace(/\.md$/i, '').replace(/\/+$/, '');
      return PAGES[s] ? s : null;
    }
    const arr = STEM[t.toLowerCase()];
    if (!arr || !arr.length) return null;
    if (arr.length === 1) return arr[0];
    return arr.slice().sort(function (a, b) { return a.split('/').length - b.split('/').length; })[0];
  }
  function absPath(t, base) { // resolve a relative ref against the page's folder (shared by .md links and images)
    const path = t.split('#')[0].split('?')[0];
    if (!path) return '';
    return path.charAt(0) === '/' ? path.slice(1) : normalizeParts((base ? base.split('/') : []).concat(path.split('/'))).join('/');
  }
  function resolveMdPath(t, base) {
    const abs = absPath(t, base).replace(/\.md$/i, '');
    return PAGES[abs] ? abs : null;
  }

  // ---------- index ----------
  function buildIndex() {
    PAGES = {}; STEM = {};
    RAW.forEach(function (p) {
      if (p.src === undefined) p.src = p.content;
      const fm = parseFrontmatter(p.src);
      const folder = p.slug.indexOf('/') !== -1 ? p.slug.slice(0, p.slug.lastIndexOf('/')) : '';
      const stemFile = p.slug.split('/').pop();
      p.tags = fm.tags; p.folder = folder; p.content = fm.body;
      let title = fm.title;
      if (!title) { const h1 = fm.body.match(/^#\s+(.+)$/m); title = h1 ? h1[1].trim() : ''; }
      if (!title) title = stemFile.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
      p.title = title;
      PAGES[p.slug] = p;
      (STEM[stemFile.toLowerCase()] = STEM[stemFile.toLowerCase()] || []).push(p.slug);
    });
    for (const slug in PAGES) PAGES[slug].links = outLinks(PAGES[slug]);
  }
  function outLinks(p) {
    const set = new Set();
    outsideCode(p.content, function (s) { // mentions inside code do not create backlinks
      let m; const w = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;
      while ((m = w.exec(s))) { const slug = resolveSlug(m[1].trim()); if (slug) set.add(slug); }
      const l = /\]\(([^)]+)\)/g;
      while ((m = l.exec(s))) { const t = m[1].trim(); if (/\.md($|#|\?)/i.test(t)) { const slug = resolveMdPath(t, p.folder); if (slug) set.add(slug); } }
      return s;
    });
    return set;
  }

  // ---------- wiki + footnotes ----------
  // [[…]]/[^…] rewriting must skip ``` fences and `spans`, otherwise example
  // sources written inside code get rewritten into mangled link markup.
  // shortcut: only ```/~~~ fences and single-` spans are protected; unclosed
  // fences and ``-spans can still be rewritten — upgrade to a real tokenizer
  // if a page needs that
  function outsideCode(src, fn) {
    const re = /([ \t]{0,3}(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]{0,3}(?:```|~~~)[ \t]*$|`[^`\n]+`)/gm;
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      out += fn(src.slice(last, m.index)) + m[0]; // text before the code run is rewritten, code run kept
      last = re.lastIndex;
    }
    return out + fn(src.slice(last));
  }
  function wikiLinks(src) {
    return outsideCode(src, function (s) {
      return s.replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g, function (m, target, display) {
        const t = target.trim();
        const label = (display ? display.trim() : t).replace(/\.md$/i, '');
        const slug = resolveSlug(t);
        if (slug) return '[' + label + '](#' + encodeURIComponent(slug) + ')';
        return '<span class="broken-wiki">[' + escapeHtml(label) + ']</span>';
      });
    });
  }
  function withFootnotes(src) {
    const lines = src.split('\n'); const body = []; const defs = {}; let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^[ \t]{0,3}(?:```|~~~)/.test(lines[i])) { inFence = !inFence; body.push(lines[i]); continue; } // fences pass through untouched
      if (inFence) { body.push(lines[i]); continue; }
      const m = lines[i].match(/^\s{0,3}\[\^([^\]]+)\]:\s?([\s\S]*)$/);
      if (m) {
        const id = m[1].trim();
        if (!(id in defs)) defs[id] = '';
        defs[id] += (defs[id] ? ' ' : '') + m[2];
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s{0,3}\[\^[^\]]+\]:/.test(lines[i + 1])) { i++; defs[id] += ' ' + lines[i].trim(); }
        body.push('');
      } else body.push(lines[i]);
    }
    const num = {}; const used = [];
    const nbody = outsideCode(body.join('\n'), function (b) { return b.replace(/\[\^([^\]]+)\]/g, function (mm, id) {
      id = id.trim();
      if (!(id in num)) { num[id] = used.length + 1; used.push(id); }
      const n = num[id];
      return '<sup id="fnref-' + n + '"><a href="#fn-' + n + '">' + n + '</a></sup>';
    }); });
    let html = md.render(nbody);
    if (used.length) {
      html += '<section class="footnotes"><hr><ol>' + used.map(function (id) {
        const n = num[id];
        return '<li id="fn-' + n + '">' + md.renderInline(defs[id] || '') + ' <a href="#fnref-' + n + '">&uarr;</a></li>';
      }).join('') + '</ol></section>';
    }
    return html;
  }
  function renderMarkdown(src) { return withFootnotes(wikiLinks(src)); }

  // ---------- post-render ----------
  function fixMdLinks(pageNode, base) {
    pageNode.querySelectorAll('a[href]').forEach(function (a) {
      const h = a.getAttribute('href');
      if (!h || h.charAt(0) === '#') return;
      if (/^(https?:|mailto:|file:)/i.test(h)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.classList.add('ext-link'); } // external + file: links: keep the wiki in place
      else if (/\.md($|#|\?)/i.test(h)) { const s = resolveMdPath(h, base); if (s) a.setAttribute('href', '#' + encodeURIComponent(s)); }
      else if (/\.html?($|#|\?)/i.test(h)) { const abs = absPath(h, base); if (abs) { a.setAttribute('href', 'articles/' + abs); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.classList.add('html-file'); } } // local HTML files leave the frame: new tab, like external links
    });
    pageNode.querySelectorAll('img[src]').forEach(function (im) { // local images resolve against the page folder, same as .md links; live mode holds the bytes in IMAGES, bundled mode points at the articles/ files so they lazy-load
      const s = im.getAttribute('src');
      if (!s || /^(https?:|file:|data:)/i.test(s)) return; // no extension filter: the browser renders whatever format it supports
      const abs = absPath(s, base);
      im.src = IMAGES[abs] || 'articles/' + abs; // shortcut: 'articles' must match build.sh's KB dir — read from settings if it ever becomes configurable
    });
  }
  function highlightCode(pageNode) {
    if (!window.hljs) return;
    pageNode.querySelectorAll('pre code').forEach(function (c) {
      if (/language-mermaid\b/.test(c.className)) return;
      try { hljs.highlightElement(c); } catch (e) {} // reads the language-js class markdown-it already set; auto-detects when the fence has no language
    });
  }
  function runKaTeX(pageNode) {
    if (!window.renderMathInElement) return;
    try {
      renderMathInElement(pageNode, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'style', 'textarea', 'pre', 'code'] // this auto-render lowercases nodeName before matching — capitals would match nothing
      });
    } catch (e) {}
  }
  let mermaidQueue = Promise.resolve();
  function queueMermaid(job) { mermaidQueue = mermaidQueue.then(job).catch(function () {}); }
  function runMermaid(pageNode) {
    const nodes = [];
    pageNode.querySelectorAll('pre code.language-mermaid').forEach(function (code) {
      const div = document.createElement('div'); div.className = 'mermaid'; div.textContent = div.dataset.src = code.textContent;
      const pre = code.closest('pre'); pre.replaceWith(div); nodes.push(div);
    });
    if (nodes.length && window.mermaid) queueMermaid(function () { return mermaid.run({ nodes: nodes }); });
  }
  function redrawMermaid() { // mermaid bakes its theme into the SVG: when the mode flips, draw the page's diagrams again from their source
    const theme = currentMermaidTheme();
    if (theme === mermaidTheme) return;
    mermaidTheme = theme;
    queueMermaid(function () {
      initMermaid(mermaidTheme);
      const nodes = Array.from(el('page').querySelectorAll('.mermaid[data-src]'));
      nodes.forEach(function (n) { n.removeAttribute('data-processed'); n.textContent = n.dataset.src; });
      if (nodes.length && window.mermaid) return mermaid.run({ nodes: nodes });
    });
  }
  function addCopyButtons(pageNode) {
    pageNode.querySelectorAll('pre').forEach(function (pre) {
      if (pre.querySelector('.copybtn')) return;
      const b = document.createElement('button');
      b.className = 'copybtn'; b.type = 'button'; b.title = 'Copy code snippet'; b.setAttribute('aria-label', 'Copy code snippet');
      pre.appendChild(b);
    });
  }
  function copyText(text, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(cb, function () { legacyCopy(text); cb(); });
    } else { legacyCopy(text); cb(); }
  }
  function legacyCopy(text) { // clipboard API fallback (e.g. older Firefox on file://)
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove();
  }
  function buildToc(pageNode, pageTitle) { // an h1 that echoes the shown title duplicates the sidebar/rail link — skip it
    const t = (pageTitle || '').trim().toLowerCase();
    const heads = Array.prototype.slice.call(pageNode.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(function (h) { const lvl = +h.tagName[1]; return lvl <= tocLevels && (lvl > 1 || h.textContent.trim().toLowerCase() !== t); }); // tagName is uppercase: 'H2'[1] -> 2
    if (!heads.length) { tocHtml = ''; placeToc(); return; }
    let html = '';
    heads.forEach(function (h) {
      if (!h.id) h.id = 'hd-' + Math.random().toString(36).slice(2, 8);
      const lvl = +h.tagName[1] - 1;
      html += '<a href="#' + h.id + '" class="toclink toc-l' + lvl + '">' + escapeHtml(h.textContent.trim()) + '</a>';
    });
    tocHtml = '<div class="page-toc">' + html + '</div>';
    placeToc();
  }
  function placeToc() { // right rail only occupies its column when the setting is right AND the page has a TOC
    const show = tocSide === 'right' && !!tocHtml;
    el('content').classList.toggle('toc-right', show);
    el('tocRail').classList.toggle('hidden', !show);
    el('tocRail').innerHTML = show ? tocHtml : '';
    markTocPosition();
  }
  function markTocPosition() { // scroll-spy: the TOC link of the section the article is currently scrolled into lights up
    const links = document.querySelectorAll('.page-toc .toclink');
    if (!links.length) return;
    const cTop = el('content').getBoundingClientRect().top;
    let cur = null; // links are in heading order: the last one already scrolled past the top edge wins
    Array.prototype.forEach.call(links, function (l) { const h = document.getElementById(l.getAttribute('href').slice(1)); if (h && h.getBoundingClientRect().top - cTop <= 20) cur = l; });
    Array.prototype.forEach.call(links, function (l) { l.classList.toggle('active', l === cur); });
  }
  function renderBacklinks(slug) {
    const box = el('backlinks');
    const from = Object.keys(PAGES).filter(function (s) { return s !== slug && PAGES[s].links.has(slug); });
    if (!from.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<h3>Linked from</h3>' + from.map(function (s) {
      return '<a href="#' + encodeURIComponent(s) + '">' + escapeHtml(titleOf(s)) + '</a>';
    }).join(', ');
  }

  // ---------- page render ----------
  function crumbHtml(slug) {
    const parts = slug.split('/');
    let html = '<a href="#">articles</a>';
    parts.forEach(function (p, i) {
      const isLast = i === parts.length - 1;
      html += '<span class="crumb-sep">›</span>' + escapeHtml(p + (isLast ? '.md' : ''));
    });
    return '<nav class="breadcrumbs">' + html + '</nav>';
  }
  function renderPage(slug) {
    const page = el('page'); const p = PAGES[slug];
    if (!p) {
      page.innerHTML = '<h1>Not found</h1><p>No page at <code>' + escapeHtml(slug) + '</code>.</p>';
      tocHtml = ''; el('backlinks').innerHTML = ''; placeToc();
      return;
    }
    page.innerHTML = renderMarkdown(p.content);
    page.insertAdjacentHTML('afterbegin', crumbHtml(slug));
    if (mode === 'live') page.querySelector('.breadcrumbs').insertAdjacentHTML('beforeend', '<button class="btn edit-btn" type="button" data-edit="open">Edit</button><span id="editNote" class="edit-msg"></span>');
    fixMdLinks(page, p.folder);
    highlightCode(page);
    runKaTeX(page);
    runMermaid(page);
    addCopyButtons(page);
    buildToc(page, p.title);
    renderBacklinks(slug);
  }

  // ---------- home ----------
  function renderHome() {
    const page = el('page'); tocHtml = ''; el('backlinks').innerHTML = ''; placeToc();
    page.classList.add('home');
    const slugs = Object.keys(PAGES).filter(function (s) { return !activeTag || PAGES[s].tags.indexOf(activeTag) !== -1; });
    const byFolder = {};
    slugs.forEach(function (s) { const f = PAGES[s].folder || '(root)'; (byFolder[f] = byFolder[f] || []).push(s); });
    if (!Object.keys(PAGES).length) {
      page.innerHTML = '<h1>Home</h1><p class="meta">No pages yet. Add <code>.md</code> files to <code>articles/</code> and run the build, or use <b>Live render</b>.</p>';
      return;
    }
    const recent = Object.values(PAGES).filter(function (p) { return !activeTag || p.tags.indexOf(activeTag) !== -1; }).sort(function (a, b) { return b.mtime - a.mtime; }).slice(0, 8);
    let html = '<h1>' + (activeTag ? 'Tagged: ' + escapeHtml(activeTag) : 'Home') + '</h1>';
    html += '<h2>Recent</h2><ul class="recent">' + recent.map(function (p) {
      return '<li><a href="#' + encodeURIComponent(p.slug) + '">' + escapeHtml(p.title) + '</a> <span class="meta">' + new Date(p.mtime * 1000).toLocaleDateString() + '</span></li>';
    }).join('') + '</ul>';
    html += '<h2>All pages</h2>';
    Object.keys(byFolder).sort().forEach(function (f) {
      html += '<div class="home-folder">' + escapeHtml(f) + '</div><ul>';
      byFolder[f].slice().sort(function (a, b) { return titleOf(a).localeCompare(titleOf(b)); }).forEach(function (s) {
        html += '<li><a href="#' + encodeURIComponent(s) + '">' + escapeHtml(titleOf(s)) + '</a></li>';
      });
      html += '</ul>';
    });
    page.innerHTML = html;
  }

  // ---------- sidebar / tags ----------
  function renderSidebar() {
    const tree = el('tree');
    const slugs = Object.keys(PAGES).filter(function (s) { return !activeTag || PAGES[s].tags.indexOf(activeTag) !== -1; });
    const root = { pages: [], subs: {} }; // nested tree: folder -> its pages + subfolders
    slugs.forEach(function (s) {
      const parts = PAGES[s].folder ? PAGES[s].folder.split('/') : [];
      let node = root;
      parts.forEach(function (part) { node.subs[part] = node.subs[part] || { pages: [], subs: {} }; node = node.subs[part]; });
      node.pages.push(s);
    });
    // a folder is open when it contains the page on screen (or the landing page),
    // otherwise per the foldersOpen setting
    const shown = shownPage || (landingPage && PAGES[landingPage] ? landingPage : '');
    const activeFolder = PAGES[shown] ? (PAGES[shown].folder || '') : '';
    const isOpen = function (p) {
      return activeFolder ? (activeFolder === p || activeFolder.indexOf(p + '/') === 0) : foldersOpen;
    };
    const linkHtml = function (s) {
      return '<a href="#' + encodeURIComponent(s) + '" data-slug="' + escapeHtml(s) + '">' + escapeHtml(titleOf(s)) + '</a>';
    };
    const orderedItems = function (node, path) { // [display name, html] pairs, per sidebarOrder
      const pages = node.pages.slice().sort(function (a, b) { return titleOf(a).localeCompare(titleOf(b)); });
      const folderItems = Object.keys(node.subs).sort().map(function (sub) { return [sub, renderNode(sub, node.subs[sub], path)]; });
      let list = pages.map(function (s) { return [titleOf(s), linkHtml(s)]; });
      if (sidebarOrder === 'folders') list = folderItems.concat(list);
      else if (sidebarOrder === 'alpha') { list = list.concat(folderItems); list.sort(function (a, b) { return a[0].localeCompare(b[0]); }); }
      else list = list.concat(folderItems); // 'files': files first, then folders
      return list;
    };
    const renderNode = function (name, node, path) { // one <details> per folder, nested for subfolders
      const p = path ? path + '/' + name : name;
      let h = '<details class="grp"' + (isOpen(p) ? ' open' : '') + '><summary>' + escapeHtml(name) + '</summary><div class="grp-body">';
      h += orderedItems(node, p).map(function (i) { return i[1]; }).join('');
      return h + '</div></details>';
    };
    // root pages are listed flat (no folder); top-level folders are <details> groups
    let html = orderedItems(root, '').map(function (i) { return i[1]; }).join('');
    if (!slugs.length) html = '<div class="empty">No pages.</div>';
    tree.innerHTML = html;
    markActive();
  }
  function syncModeGroup() { // narrow: the mode badge + live buttons ride the drawer, above the tree; wide: back in the topbar
    const g = document.querySelector('.modegrp');
    if (narrowMq.matches === (g.parentNode.id === 'sidebar')) return;
    if (narrowMq.matches) el('sidebar').insertBefore(g, el('sidebar').firstChild);
    else document.querySelector('.topbar').appendChild(g); // it was the last group already
  }
  function markActive() {
    const slug = shownPage;
    const tree = el('tree');
    const links = Array.prototype.slice.call(tree.querySelectorAll('a'));
    links.forEach(function (a) { a.classList.toggle('active', a.dataset.slug === slug); });
    tree.querySelectorAll('.page-toc').forEach(function (n) { n.remove(); });
    if (slug && tocHtml && (tocSide === 'left' || narrowMq.matches)) { // narrow: the right rail is gone, the TOC follows the drawer instead
      const act = links.find(function (a) { return a.dataset.slug === slug; });
      if (act) act.insertAdjacentHTML('afterend', tocHtml); // TOC sits directly under the file name
    }
    markTocPosition();
  }
  function renderTags() {
    const box = el('tags');
    const tags = {};
    Object.keys(PAGES).forEach(function (s) { PAGES[s].tags.forEach(function (t) { (tags[t] = tags[t] || []).push(s); }); });
    const names = Object.keys(tags);
    if (!names.length) { box.innerHTML = ''; return; }
    box.innerHTML = names.map(function (t) {
      return '<span class="tag' + (activeTag === t ? ' active' : '') + '" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
    }).join('');
  }

  // ---------- search ----------
  function markHits(text, q) { // wrap every case-insensitive hit in <mark>; escape per-segment so the query can't inject HTML
    let out = '', i = 0;
    const t = text.toLowerCase();
    for (let j = t.indexOf(q, i); j >= 0; j = t.indexOf(q, i)) {
      out += escapeHtml(text.slice(i, j)) + '<mark>' + escapeHtml(text.slice(j, j + q.length)) + '</mark>';
      i = j + q.length;
    }
    return out + escapeHtml(text.slice(i));
  }
  function snippet(content, q) {
    const t = content.replace(/[#*`>\[\]_~]/g, ' ').replace(/\s+/g, ' ');
    const i = t.toLowerCase().indexOf(q);
    return i < 0 ? t.slice(0, 120) : t.slice(Math.max(0, i - 40), i + 90);
  }
  function doSearch(q) {
    q = q.trim().toLowerCase(); const box = el('searchResults');
    el('clearSearch').classList.toggle('show', q.length > 0); // own ✕ button — Firefox has no native one
    if (!q) { box.classList.add('hidden'); return; }
    const max = Math.max(1, parseInt(WIKI.maxResults, 10) || 200);
    const all = Object.keys(PAGES).filter(function (s) { return (PAGES[s].title + ' ' + PAGES[s].content).toLowerCase().indexOf(q) !== -1; });
    const hits = all.slice(0, max);
    box.innerHTML = hits.length ? hits.map(function (s) {
      return '<a href="#' + encodeURIComponent(s) + '"><span class="crumb">' + markHits((PAGES[s].folder ? PAGES[s].folder + ' / ' : '') + PAGES[s].title, q) + '</span>' + markHits(snippet(PAGES[s].content, q), q) + '</a>';
    }).join('') : '<a>&mdash; no results &mdash;</a>';
    if (all.length > max) box.innerHTML += '<div class="search-note">' + all.length + ' matches &mdash; showing the first ' + max + '. Edit <code>maxResults</code> in config.js to see more.</div>';
    box.classList.remove('hidden');
  }

  // ---------- mode ----------
  function setMode(m) {
    const e = el('mode');
    e.textContent = m === 'live' ? ('live · ' + (liveHandle ? liveHandle.name : 'folder')) : 'bundled · data.js';
    e.className = 'mode' + (m === 'live' ? ' live' : '');
    const r = el('refresh'); if (r) r.classList.toggle('hidden', m !== 'live');
  }

  // ---------- routing ----------
  function closeNav() { // narrow-screen drawer: close it (also a harmless no-op on wide screens)
    document.body.classList.remove('nav-open');
    const b = el('menuBtn');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function renderLanding() { // what the empty hash shows: the configured page, else the generated home
    if (landingPage && PAGES[landingPage]) { renderPage(landingPage); return PAGES[landingPage].title; }
    renderHome(); return 'Home';
  }
  function route() {
    let slug = location.hash.slice(1);
    if (slug) slug = decodeURIComponent(slug);
    if (slug && /^(fn|fnref)-/.test(slug)) return; // in-page footnote anchor
    closeNav(); // picking a page in the drawer closes it
    showPage(slug);
    el('content').scrollTop = 0; // hash-only navigation: the browser never resets the article container, so do it here
  }
  function showPage(slug) {
    shownPage = slug; editing = null;
    el('page').classList.remove('home');
    if (!slug) { document.title = renderLanding() + ' — ' + wikiName; }
    else { renderPage(slug); document.title = (PAGES[slug] ? PAGES[slug].title : slug) + ' — ' + wikiName; }
    renderSidebar(); // re-renders with the active page's folder chain open; ends with markActive()
  }

  // ---------- loaders ----------
  function loadBundled() {
    RAW = (window.PAGES_BUNDLED || []).map(function (p) { return { slug: p.slug, mtime: p.mtime, content: b64toUtf8(p.content) }; });
    IMAGES = {};
  }
  async function loadLive(handle) {
    const live = { stamp: await folderStamp(handle), raw: [], images: {} };
    await walkDir(handle, '', live.raw, live.images);
    return live;
  }
  function applyLive(live) { liveStamp = live.stamp; RAW = live.raw; IMAGES = live.images; }
  async function folderStamp(dir, prefix = '') {
    let stamp = '';
    for await (const e of dir.values()) {
      if (e.kind === 'directory') stamp += await folderStamp(e, prefix + e.name + '/');
      else if (/\.md$/i.test(e.name) || imgExtRe.test(e.name)) stamp += prefix + e.name + ':' + (await e.getFile()).lastModified + '\n';
    }
    return stamp;
  }
  async function fileAt(root, path) {
    const parts = path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return dir.getFileHandle(parts[parts.length - 1]);
  }
  async function readForEdit(root, path) {
    const f = await (await fileAt(root, path)).getFile();
    const raw = await f.text();
    return { text: raw.replace(/\r\n/g, '\n'), version: { modified: f.lastModified, raw: raw } };
  }
  async function saveFile(root, path, text, version) {
    const handle = await fileAt(root, path);
    const current = await handle.getFile();
    const raw = await current.text();
    if (current.lastModified !== version.modified || raw !== version.raw) return { ok: false };
    const out = raw.indexOf('\r\n') !== -1 ? text.replace(/\r?\n/g, '\r\n') : text;
    const w = await handle.createWritable();
    await w.write(out);
    await w.close();
    return { ok: true, version: { modified: (await handle.getFile()).lastModified, raw: out } };
  }
  function extRe(list) { // live-render image list, set by imageExts in config.js; junk entries dropped, empty falls back to the built-in list
    const ok = (Array.isArray(list) ? list : []).filter(function (s) { return /^[a-z0-9]+$/i.test(s); });
    return new RegExp('\\.(' + (ok.length ? ok.join('|') : 'png|jpg|jpeg|gif|svg|webp') + ')$', 'i');
  }
  const imgExtRe = extRe(WIKI.imageExts); // bundled mode has no filter at all — the browser paints any format it supports
  async function walkDir(handle, prefix, acc, images) {
    for await (const e of handle.values()) {
      if (e.kind === 'file') {
        if (/\.md$/i.test(e.name)) {
          const f = await e.getFile();
          acc.push({ slug: (prefix + e.name).replace(/\.md$/i, ''), path: prefix + e.name, mtime: Math.floor(f.lastModified / 1000), content: await f.text() });
        } else if (imgExtRe.test(e.name)) {
          images[prefix + e.name] = await fileToDataURI(await e.getFile(), e.name);
        }
      } else if (e.kind === 'directory') {
        await walkDir(e, prefix + e.name + '/', acc, images);
      }
    }
  }
  async function fileToDataURI(f, name) {
    const ext = name.split('.').pop().toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    const u8 = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return 'data:' + mime + ';base64,' + btoa(bin);
  }
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise(function (res, rej) {
        const r = indexedDB.open('localwiki', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { IDB.db = r.result; res(IDB.db); };
        r.onerror = function () { rej(r.error); };
      });
    },
    async get(k) { const d = await this.open(); return new Promise(function (res) { const g = d.transaction('kv').objectStore('kv').get(k); g.onsuccess = function () { res(g.result); }; }); },
    async set(k, v) { const d = await this.open(); const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); }
  };
  async function showFolder(h) {
    const mine = loading = { h: h };
    try {
      if ((await h.queryPermission({ mode: 'read' })) !== 'granted') return false;
      const live = await loadLive(h);
      if (loading !== mine || editing) return false;
      const scroll = h === liveHandle ? el('content').scrollTop : 0;
      liveHandle = h; applyLive(live); mode = 'live';
      buildIndex(); renderTags(); setMode('live'); showPage(shownPage);
      el('content').scrollTop = scroll;
      return true;
    } catch (e) { return false; } finally { if (loading === mine) loading = null; }
  }
  async function chooseFolder() {
    if (editing) return;
    try {
      const h = await showDirectoryPicker({ mode: 'readwrite' });
      if (!(await showFolder(h))) return;
      closeNav();
      await IDB.set('dir', h);
    } catch (e) { /* cancelled or permission denied */ }
  }
  function refreshLive() {
    if (mode !== 'live' || editing || (loading && loading.h !== liveHandle)) return false;
    const now = Date.now(); if (now - lastRefresh < 1500) return false; lastRefresh = now;
    return showFolder(liveHandle);
  }
  async function pollLive() {
    if (mode !== 'live' || editing || loading || document.hidden) return;
    const mine = loading = { h: liveHandle };
    let changed = false;
    try { changed = (await folderStamp(liveHandle)) !== liveStamp; } catch (e) {}
    if (loading !== mine) return;
    loading = null;
    if (changed) { lastRefresh = 0; await refreshLive(); }
  }

  function editMsg(text) { const m = el('editMsg'); if (m) m.textContent = text; }
  function lockEditor(locked) { el('editText').readOnly = locked; el('editSave').disabled = locked; el('editCancel').disabled = locked; }
  async function openEditor() {
    const slug = shownPage || landingPage; const p = PAGES[slug]; const h = liveHandle;
    if (!p || !h || editing) return;
    try {
      if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      const opened = await readForEdit(h, p.path);
      if (liveHandle !== h || !PAGES[slug] || (shownPage || landingPage) !== slug || editing) return;
      if (opened.text.indexOf('\uFFFD') !== -1) {
        el('editNote').textContent = 'This page is not saved as UTF-8 text, so saving it here would damage its special characters. Convert it to UTF-8 in a text editor first.';
        return;
      }
      editing = { root: h, slug: slug, path: p.path, version: opened.version, saving: false };
      const page = el('page');
      page.innerHTML = crumbHtml(slug) + '<div class="editor"><textarea id="editText" spellcheck="false"></textarea>' +
        '<div class="editor-bar"><button id="editSave" class="btn" type="button" data-edit="save">Save</button>' +
        '<button id="editCancel" class="btn" type="button" data-edit="cancel">Cancel</button><span id="editMsg" class="edit-msg"></span></div></div>';
      el('editText').value = opened.text;
      el('editText').focus();
      tocHtml = ''; placeToc(); markActive(); el('backlinks').innerHTML = '';
    } catch (e) {}
  }
  async function saveEditor() {
    const ed = editing;
    if (!ed || ed.saving) return;
    ed.saving = true; lockEditor(true); editMsg('Saving\u2026');
    let r;
    try { r = await saveFile(ed.root, ed.path, el('editText').value, ed.version); }
    catch (e) { r = { error: e }; }
    if (r.ok) {
      if (loading && loading.h === ed.root) loading = null;
      if (liveHandle === ed.root && PAGES[ed.slug]) { PAGES[ed.slug].src = r.version.raw; buildIndex(); liveStamp = null; }
    }
    if (editing !== ed) return;
    if (!r.ok) {
      ed.saving = false; lockEditor(false);
      editMsg(r.error ? 'Could not save: ' + r.error.message : 'Someone else changed this page while you were editing. Your text is still in the box: copy it, press Cancel to see their version, then edit again.');
      return;
    }
    renderTags(); showPage(shownPage);
  }
  function cancelEditor() { showPage(shownPage); lastRefresh = 0; refreshLive(); }

  // ---------- init ----------
  async function init() {
    el('refresh').addEventListener('click', refreshLive);
    window.addEventListener('focus', function () { if (!loading) refreshLive(); }); // re-read live folder when the tab regains focus
    setInterval(pollLive, 5000);
    el('search').addEventListener('input', function (e) { doSearch(e.target.value); });
    const themeBtn = el('themeBtn');
    const themeName = { system: 'System', light: 'Light', dark: 'Dark' };
    const showTheme = function (t) {
      themeBtn.dataset.theme = t;
      themeBtn.title = 'Theme: ' + themeName[t] + ' (click for ' + themeName[nextTheme(t)] + ')';
      themeBtn.setAttribute('aria-label', themeBtn.title);
    };
    showTheme(document.documentElement.style.colorScheme || 'system'); // the <head> script already applied the saved choice
    themeBtn.addEventListener('click', function () {
      const t = nextTheme(themeBtn.dataset.theme);
      document.documentElement.style.colorScheme = t === 'system' ? '' : t;
      showTheme(t); redrawMermaid();
      try { localStorage.setItem('theme', t); } catch (e) {} // blocked storage: the choice lasts until reload
    });
    systemDark.addEventListener('change', redrawMermaid);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    el('searchKey').textContent = mac ? '\u2318K' : 'Ctrl K';
    document.addEventListener('keydown', function (e) {
      if (isSearchShortcut(e, mac)) { e.preventDefault(); el('search').focus(); el('search').select(); }
    });
    el('search').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.target.value = ''; doSearch(''); } });
    el('search').addEventListener('click', function (e) { if (e.target.value) doSearch(e.target.value); }); // query still in the box → panel comes back
    document.addEventListener('click', function (e) { // any click outside box+panel dismisses the panel (text stays in the box)
      if (!e.target.closest('.search-wrap, #searchResults')) el('searchResults').classList.add('hidden');
    });
    el('searchResults').addEventListener('click', function () { el('search').blur(); });
    el('clearSearch').addEventListener('click', function () {
      el('search').value = ''; doSearch(''); el('search').focus();
    });
    el('page').addEventListener('click', function (e) { // delegated: page content is re-rendered constantly
      const tb = e.target.closest('.tabs-bar button'); // ::: tabs switching
      if (tb) {
        const bar = tb.parentElement, wrap = bar.parentElement;
        bar.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === tb); });
        wrap.querySelectorAll('.tab-pane').forEach(function (p) { p.hidden = p.getAttribute('data-i') !== tb.getAttribute('data-i'); });
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) { ({ open: openEditor, save: saveEditor, cancel: cancelEditor })[ed.dataset.edit](); return; }
      const b = e.target.closest('.copybtn');
      if (!b) return;
      const code = b.closest('pre').querySelector('code');
      copyText(code ? code.textContent : b.closest('pre').textContent, function () {
        b.classList.add('copied');
        setTimeout(function () { b.classList.remove('copied'); }, 1500);
      });
    });
    const tocScroll = function (e) {
      const a = e.target.closest('a.toclink');
      if (a) { e.preventDefault(); const t = document.getElementById(a.getAttribute('href').slice(1)); if (t) t.scrollIntoView({ behavior: 'smooth' }); closeNav(); } // inside the drawer, jumping into the article closes it
    };
    el('tree').addEventListener('click', tocScroll);
    let spyRaf = 0; // scroll-spy, rAF-throttled: one pass per frame at most
    el('content').addEventListener('scroll', function () { if (!spyRaf) spyRaf = requestAnimationFrame(function () { spyRaf = 0; markTocPosition(); }); }, { passive: true });
    el('tree').addEventListener('click', function (e) { // clicking the current page's entry: same hash means no hashchange, so scroll the article back to the top
      const a = e.target.closest('a[data-slug]');
      if (a && a.dataset.slug === shownPage) { e.preventDefault(); closeNav(); el('content').scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    el('tocRail').addEventListener('click', tocScroll);
    // narrow screens: the hamburger opens the sidebar as an overlay drawer
    el('menuBtn').addEventListener('click', function () {
      const open = document.body.classList.toggle('nav-open');
      this.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) { // backdrop, or any click outside the drawer, closes it
      if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar, #menuBtn')) closeNav();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
    narrowMq.addEventListener('change', function () { if (!narrowMq.matches) closeNav(); renderSidebar(); syncModeGroup(); }); // crossing the breakpoint moves the TOC between rail and tree, and the mode group between topbar and drawer
    el('tags').addEventListener('click', function (e) {
      const t = e.target.closest('.tag'); if (!t) return;
      activeTag = (activeTag === t.dataset.tag) ? '' : t.dataset.tag;
      renderTags(); renderSidebar();
      if (!location.hash.slice(1) && !editing) route();
    });

    const canPick = typeof showDirectoryPicker === 'function';
    el('choose').classList.toggle('hidden', !canPick); // hidden by default; revealed only where the File System Access API exists

    // resizable sidebar: drag the strip, width clamped 140–480 and remembered
    const setSidebarW = function (w) { document.documentElement.style.setProperty('--sidebar-w', w + 'px'); };
    let savedW = NaN;
    try { savedW = parseInt(localStorage.getItem('sidebar-w'), 10); } catch (e) {} // blocked storage: default width
    if (savedW >= 140 && savedW <= 480) setSidebarW(savedW);
    el('resizer').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      let w = 0;
      const move = function (ev) { w = Math.min(480, Math.max(140, ev.clientX)); setSidebarW(w); };
      const up = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (w) { try { localStorage.setItem('sidebar-w', w); } catch (e) {} } };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    try {
      const h = await IDB.get('dir');
      if (h) { const perm = await h.queryPermission({ mode: 'read' }); if (perm === 'granted') { applyLive(await loadLive(h)); liveHandle = h; mode = 'live'; } }
    } catch (e) {}
    el('choose').addEventListener('click', chooseFolder);
    if (mode !== 'live') loadBundled();

    buildIndex();
    renderSidebar(); renderTags(); syncModeGroup();
    setMode(mode);
    window.addEventListener('hashchange', route);
    if (expandOnPrint) { // CSS can't open <details>, so open every fold in the article for the paper, then restore
      let openedForPrint = [];
      window.addEventListener('beforeprint', function () {
        openedForPrint = Array.prototype.filter.call(document.querySelectorAll('#page details.fold'), function (d) { return !d.open; });
        openedForPrint.forEach(function (d) { d.open = true; });
      });
      window.addEventListener('afterprint', function () {
        openedForPrint.forEach(function (d) { d.open = false; });
        openedForPrint = [];
      });
    }
    route();
    lastRefresh = Date.now();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
