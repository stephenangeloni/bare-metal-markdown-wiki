/* ═══════════════════════════════════════════════════════════
   mdit-extras.js — markdown-it extras, dependency-free IIFE
   Implements, as plain <script> (no bundler, no ES modules,
   works from file://):
     MditExtras.container(md)  — ::: name … ::: block containers
                                 (like @mdit/plugin-container), incl. the
                                 ::: fold Title collapsible variant
     MditExtras.alerts(md)     — GitHub-style > [!NOTE] alerts
                                 (like @mdit/plugin-alert)
     MditExtras.tabs(md)       — ::: tabs / ::: tab: Name panels
                                 (needs MditExtras.container first)
   Both are written against the same markdown-it block-rule API
   as the official plugins; kept here in one file so the wiki
   has zero npm dependencies.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── container: ::: name … ::: ─────────────────────────── */
  /* Opening line: "::: name" (any name, or bare ":::"). Closing
     line must be ":::" (or "::: name" matching the opener).
     The interior is parsed with the normal block rules, so code
     fences, lists, nested containers all work inside. */
  function container(md) {
    function rule(state, startLine, endLine, silent) {
      var start = state.bMarks[startLine] + state.tShift[startLine];
      var max = state.eMarks[startLine];
      if (state.src.slice(start, start + 3) !== ':::') return false;
      var name = state.src.slice(start + 3, max).trim();
      if (silent) return true;

      // Scan for the close with an open-names stack, so containers
      // can nest: a bare ":::" closes the innermost open container,
      // a "::: name" line closes it if it matches the innermost open
      // container, otherwise it opens a nested one.
      var nextLine = startLine, autoClosed = false;
      var stack = [name];
      for (;;) {
        nextLine++;
        if (nextLine >= endLine) break; // unclosed: consume to end of document
        start = state.bMarks[nextLine] + state.tShift[nextLine];
        max = state.eMarks[nextLine];
        if (start < max && state.sCount[nextLine] < state.blkIndent) break;
        if (state.src.charAt(start) !== ':') continue;
        var s = state.src.slice(start, max).replace(/[ \t]+$/, '');
        if (s === ':::') {
          stack.pop();
          if (!stack.length) { autoClosed = true; break; }
        } else if (s.length > 3 && (s.charCodeAt(3) === 32 || s.charCodeAt(3) === 9)) {
          var cname = s.slice(3).trim();
          if (cname === stack[stack.length - 1]) stack.pop();
          else stack.push(cname);
        }
      }

      var oldParent = state.parentType, oldLineMax = state.lineMax;
      state.parentType = 'container';
      state.lineMax = nextLine; // keep lazy continuations from crossing the end

      var fm = /^fold(!)?(?:[ \t]+(.*))?$/.exec(name); // ::: fold Title — collapsible section; "fold!" starts open, no title → browser's built-in label
      var open = state.push('mdit_container_open', fm ? 'details' : 'div', 1);
      open.markup = '::: ' + name; open.block = true; open.info = name;
      open.map = [startLine, nextLine];
      if (fm) { open.foldOpen = !!fm[1]; open.foldTitleHtml = fm[2] ? state.md.renderInline(fm[2]) : ''; } // titles get inline markdown, like tab names

      state.md.block.tokenize(state, startLine + 1, nextLine);

      var close = state.push('mdit_container_close', fm ? 'details' : 'div', -1);
      close.block = true;

      state.parentType = oldParent;
      state.lineMax = oldLineMax;
      state.line = nextLine + (autoClosed ? 1 : 0);
      return true;
    }

    md.block.ruler.before('fence', 'mdit_container', rule, {
      alt: ['paragraph', 'reference', 'blockquote', 'list']
    });

    function render(tokens, idx, options, env, self) {
      if (tokens[idx].nesting === 1) {
        if (tokens[idx].tag === 'details') { // fold container: <details>, closed by the same rules as any container
          tokens[idx].attrSet('class', 'fold');
          if (tokens[idx].foldOpen) tokens[idx].attrSet('open', '');
          return self.renderToken(tokens, idx, options, env, self) +
                 (tokens[idx].foldTitleHtml ? '<summary>' + tokens[idx].foldTitleHtml + '</summary>' : '');
        }
        tokens[idx].attrSet('class', 'container' + (tokens[idx].info ? ' ' + tokens[idx].info : ''));
      }
      return self.renderToken(tokens, idx, options, env, self);
    }
    md.renderer.rules.mdit_container_open = render;
    md.renderer.rules.mdit_container_close = render;
  }

  /* ── alerts: > [!NOTE] ─────────────────────────────────── */
  /* A blockquote whose first line is exactly "> [!name]" (or
     "> [!name] custom title") becomes <div class="markdown-alert
     markdown-alert-name"> with a title paragraph. Detected after
     block parsing, before inline rendering — the marker is
     stripped from the first inline token and the blockquote
     open/close tokens are re-rendered as div + title. */
  var ALERT_NAMES = {
    note: 'Note', tip: 'Tip', important: 'Important',
    warning: 'Warning', caution: 'Caution'
  };
  var ALERT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*(.*)$/i;

  function alerts(md) {
    // must run BEFORE the built-in 'inline' core rule, which turns token
    // content into pre-parsed children (children win at render time)
    md.core.ruler.before('inline', 'mdit_alert', function (state) {
      var tokens = state.tokens;
      for (var i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'blockquote_open') continue;
        // the marker must be the first paragraph: first 'inline' child,
        // stopping at any other block (nested quote, fence, raw html…)
        var j = i + 1, t = null;
        while (j < tokens.length && tokens[j].type !== 'blockquote_close') {
          var ty = tokens[j].type;
          if (ty === 'inline') { t = tokens[j]; break; }
          if (ty === 'paragraph_open' || ty === 'paragraph_close') { j++; continue; }
          break;
        }
        if (!t) continue;
        var firstLine = t.content.split('\n', 2)[0];
        var m = ALERT_RE.exec(firstLine);
        if (!m) continue;
        var name = m[1].toLowerCase();
        tokens[i].attrSet('class', 'markdown-alert markdown-alert-' + name);
        // pre-render the title here — renderer rules have no access to md
        tokens[i].info = md.renderInline((m[2] || '').trim() || ALERT_NAMES[name]);
        t.content = t.content.slice(firstLine.length); // drop the marker line
        for (var k = i + 1, depth = 1; k < tokens.length; k++) { // tag the matching close (blockquotes can nest)
          if (tokens[k].type === 'blockquote_open') depth++;
          else if (tokens[k].type === 'blockquote_close' && --depth === 0) { tokens[k].alertClose = true; break; }
        }
      }
    });

    var origOpen = md.renderer.rules.blockquote_open;
    md.renderer.rules.blockquote_open = function (tokens, idx, options, env, self) {
      var t = tokens[idx];
      var cls = t.attrGet('class');
      if (cls && cls.indexOf('markdown-alert') === 0) {
        return '<div class="' + cls + '"><p class="markdown-alert-title">' + t.info + '</p>';
      }
      return origOpen ? origOpen(tokens, idx, options, env, self) : '<blockquote>\n';
    };

    md.renderer.rules.blockquote_close = function (tokens, idx) {
      return tokens[idx].alertClose ? '</div>\n' : '</blockquote>\n';
    };
  }

  /* ── tabs: ::: tabs / ::: tab: Name ─────────────────────── */
  /* Extends container: a ::: tabs group whose direct children
     are ::: tab: Name containers becomes a button bar + panes.
     The first pane is visible; switching is a few lines of
     delegated click handling in app.js. */
  function tabs(md) {
    // runs after block parsing: tag the child tab containers of every
    // ::: tabs group so the container renderer can emit bar + panes
    md.core.ruler.push('mdit_tabs', function (state) {
      var tokens = state.tokens;
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t.type !== 'mdit_container_open' || t.info !== 'tabs') continue;
        // direct children only, up to this group's own close
        var depth = 1, j = i + 1, tabs = [];
        while (j < tokens.length) {
          var tk = tokens[j];
          if (tk.type === 'mdit_container_open' || tk.type === 'mdit_container_close') {
            // a direct child's open is seen while depth is still 1
            if (depth === 1 && tk.type === 'mdit_container_open' && tk.info.indexOf('tab:') === 0) {
              tabs.push({ name: tk.info.slice(4).trim(), token: tk });
            }
            depth += tk.nesting;
            if (depth === 0) break;
          }
          j++;
        }
        if (!tabs.length) continue; // bare ::: tabs — leave as plain container
        t.tabList = tabs;
        tabs.forEach(function (tab, n) {
          tab.token.tabPane = true;
          tab.token.tabIndex = n;
          tab.html = state.md.renderInline(tab.name); // titles get inline markdown: badges, bold, …
        });
      }
    });

    var origOpen = md.renderer.rules.mdit_container_open;
    md.renderer.rules.mdit_container_open = function (tokens, idx, options, env, self) {
      var t = tokens[idx];
      if (t.tabList) {
        var bar = '<div class="tabs-bar">' + t.tabList.map(function (tab, n) {
          return '<button type="button" class="' + (n === 0 ? 'active' : '') + '" data-i="' + n + '">' +
                 (tab.html || ('Tab ' + (n + 1))) + '</button>';
        }).join('') + '</div>';
        return '<div class="container tabs">\n' + bar + '\n';
      }
      if (t.tabPane) {
        return '<div class="tab-pane" data-i="' + t.tabIndex + '"' + (t.tabIndex ? ' hidden' : '') + '>\n';
      }
      return origOpen(tokens, idx, options, env, self);
    };
  }

  /* ── badges: @{ name } ─────────────────────────────────────── */
  /* Inline pill, e.g. "this is @{draft} since @{v1.0}". Anything
     between @{ and } becomes a <span class="badge">, escaped.
     A lone @ (like an e-mail) is left alone — the { is required.
     Known status words get a color; the badgeColors setting in config.js — this file only keeps the defaults for when the setting is missing. */
  var DEFAULT_BADGE_COLORS = {
    green:  ['stable', 'ok', 'done', 'active', 'success', 'passed', 'shipped', 'final'],
    yellow: ['draft', 'wip', 'todo', 'pending', 'review', 'progress', 'untested'],
    red:    ['error', 'failed', 'fails', 'failing', 'broken', 'danger', 'urgent', 'deprecated'],
    blue:   ['info', 'new', 'beta', 'note', 'preview'],
    purple: ['alpha', 'experimental', 'planned', 'idea']
  };

  function badges(md) {
    var COLORS = (global.WIKI && global.WIKI.badgeColors) || DEFAULT_BADGE_COLORS;
    var LOOKUP = {}; // word → color, lowercased once: config entries match case-insensitively
    for (var c in COLORS) (COLORS[c] || []).forEach(function (w) { LOOKUP[String(w).toLowerCase()] = c; });
    var RE = /^@\{([^{}]+)\}/; // anchored: markdown-it calls inline rules at any stop-char, so an unanchored match would swallow the text before @{
    md.inline.ruler.push('mdit_badge', function (state, silent) {
      var m = RE.exec(state.src.slice(state.pos));
      if (!m) return false;
      if (!silent) {
        var token = state.push('mdit_badge', '', 0); // push, not new Token: children stack
        token.content = m[1].trim();
        state.pos += m[0].length;
      }
      return true;
    });
    md.renderer.rules.mdit_badge = function (tokens, idx) {
      var cls = 'badge';
      // the first word decides the color: @{draft review} → yellow
      var k = LOOKUP[tokens[idx].content.toLowerCase().split(/[\s\-/]+/)[0]];
      if (k) cls += ' badge--' + k;
      return '<span class="' + cls + '">' + md.utils.escapeHtml(tokens[idx].content) + '</span>';
    };
  }

  /* ── buttons: @[label](target) ─────────────────────────────── */
  /* Any link prefixed with @ renders as <a class="btn">. The built-in
     link rule does all the parsing, so the label keeps inline markdown,
     validateLink still blocks dangerous schemes, and app.js's post-pass
     (.md -> wiki slug, .html new-tab) applies unchanged. "@[[wiki link]]"
     works too because app.js rewrites [[..]] before rendering. A \@ or a
     space between the @ and the link keeps a plain link. An optional
     {color} suffix (green/yellow/red/blue/purple) fills the button. */
  function buttons(md) {
    // after 'inline': link tokens and their labels exist by now
    md.core.ruler.after('inline', 'mdit_button', function (state) {
      state.tokens.forEach(function (t) {
        if (t.type !== 'inline' || !t.children) return;
        var ch = t.children;
        for (var i = 1; i < ch.length; i++) {
          if (ch[i].type === 'link_open' && ch[i - 1].type === 'text' &&
              /@$/.test(ch[i - 1].content) && !/\\@$/.test(ch[i - 1].markup)) {
            ch[i - 1].content = ch[i - 1].content.slice(0, -1); // drop the marker
            ch[i].attrJoin('class', 'btn');
            // optional color suffix, @[label](target){red} — same palette names as
            // badges; unknown names and non-button links leave {name} as plain text
            var k = i + 1;
            while (k < ch.length && ch[k].type !== 'link_close') k++;
            var nx = ch[k + 1]; // a link label cannot contain another link: first close wins
            if (nx && nx.type === 'text') {
              var m = /^\{(green|yellow|red|blue|purple)\}/.exec(nx.content);
              if (m) { nx.content = nx.content.slice(m[0].length); ch[i].attrJoin('class', 'btn--' + m[1]); }
            }
          }
        }
      });
    });
  }

  global.MditExtras = { container: container, alerts: alerts, tabs: tabs, badges: badges, buttons: buttons };
})(window);
