# Bare-metal Markdown Wiki

This is a wiki that runs entirely in your browser, on a folder of plain Markdown files.

**No server. No runtime. No build dependencies. No network.** 

The site is one static HTML frame (`index.html` + `app.js`) that reads `.md` files and renders
them on the fly. Clone it, open `index.html`, done — it works offline, and it
works from a plain `file://` double-click.

![Screenshot](Screenshot.png)

## Features

**Wiki**

- Automatic home page — recent edits (by mtime) + all pages grouped by folder
- Subfolders — nested Markdown directories, mirrored in the sidebar as
  collapsible groups
- `[[WikiLinks]]` — `[[Page]]`, `[[Page|alias]]`, `[[subfolder/page]]`, plus
  regular `.md` links; unresolvable links are visibly marked
- Backlinks panel under every page
- Frontmatter **tags** with one-click filtering
- Live full-text search with the searched terms highlighted (result cap and
  panel width/height set in the settings block); ⌘K (Ctrl K elsewhere) jumps to the search box
- Light and dark mode: follows the system, or pick Light/Dark with the theme button
  in the top bar (remembered per browser; hidden when `user.css` forces a mode).
  Printing always uses light colours, but Mermaid diagrams keep the colours they
  were drawn in: switch to Light before printing a page with diagrams
- Per-page table of contents — placement set in the settings block:
  *left* (sidebar, under the page's file name) or *right* (rail beside the article)
- Hash routing — `#path/to/page` deep links, browser back/forward work
- External links (`http…`, `mailto:`) open in a new tab, marked with a ↗
- Resizable sidebar — drag the strip between sidebar and article; the width
  is remembered in the browser (localStorage), not in the settings file

**Markdown extras**

- Syntax-highlighted code blocks (highlight.js)
- Math via KaTeX — `$…$`, `$$…$$`, `\(...\)`
- Mermaid diagrams — `` ```mermaid `` fenced blocks
- Local images — `![alt](pic.png)` resolves against the page's folder and loads
  lazily from the `articles/` files (`data.js` stays text-only); in live-render
  mode they are read from the picked folder; `http(s)` sources load normally;
  `png` `jpg` `gif` `svg` `webp`
- Local HTML files — `[report](report.html)` resolves the same way but opens in
  a new tab (marked 📄): plain standalone files, not indexed (no sidebar/search/backlinks)
- Footnotes — `[^1]: …` at the bottom of the file

## Quick start

```bash
git clone https://github.com/Sarki/bare-metal-markdown-wiki.git
cd bare-metal-markdown-wiki
# open index.html in your browser
```

A small sample knowledge base in `articles/` demonstrates every feature.

### Adding content

1. Drop or edit `.md` files anywhere inside `articles/` (subfolders allowed)
2. Rebuild the snapshot:

   ```bash
   ./build.sh          # Linux/macOS — pure bash, offline
   build.bat           # Windows — double-click, offline
   ./build.ps1         # PowerShell (Windows, or pwsh anywhere) — offline
   ```

3. Reopen `index.html` (or just refresh — the snapshot is read at load)

That's the entire workflow. The build walks `articles/`, embeds every file
(plus its mtime) into `data.js`, and touches nothing else. No npm, no Python,
no network access.

### Live render (Chrome / Edge)

Instead of rebuilding, you can point the wiki directly at a folder on disk.

- Click **Live render** in the top bar (only shown in browsers with the
  [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) —
  Chrome/Edge)
- Pick your Markdown folder **once**; the choice is remembered (IndexedDB) and
  reused on every later open. It is remembered **per wiki copy** — the memory
  is keyed by where that `index.html` sits, so two wikis on one machine never
  end up live-rendering each other's folder (under `file://` the whole
  computer shares one IndexedDB)
- The **Bundled** button (shown in live mode) leaves live render and forgets
  the folder; **Live render** picks one again when you want it back
- The folder is **checked for changes every 5 seconds** and re-read when the
  tab regains focus, plus a **↻** button for manual refresh — a serverless
  `file://` page has no real file watcher
- A reload only redraws the page when something actually changed, and folders
  you open or close in the sidebar stay as you left them — mid-browse, the
  background reload never slams your open folders shut

Browsers cannot let a `file://` page read sibling folders without a one-time
user grant; that is the one unavoidable click. In Firefox/Safari the button
is hidden and the bundled snapshot is used instead.

### Editing (live render only)

In live render mode every page has an **Edit** button. It opens the page's
Markdown in a text box; **Save** writes the `.md` file straight back to the
folder, **Cancel** throws the changes away. The browser may ask for
permission to write to the folder. Set `editButton: false` in `config.js` to
hide the button: the wiki still reads the live folder, it just cannot be
edited from this copy.

That box is a real Markdown editor (vendored EasyMDE, CodeMirror 5 inside):
headings, emphasis, lists, links and `[[wiki links]]` are coloured as you type,
and a small toolbar covers bold, italic, heading, link, quote, code, lists,
table and undo/redo. Its buttons show words instead of icons because the wiki
ships no icon font, and there is no preview button — EasyMDE's own preview uses
a different Markdown engine, so `[[links]]` and `:::` boxes would come out
wrong there. Nothing is fetched from the internet. The **Save** and **Cancel**
buttons stay pinned to the bottom of the window while you scroll a long file.

Put the wiki on a shared network drive and several people can work on it with
no server: everyone opens `index.html` from the drive in Chrome or Edge and
picks the same folder. Each open wiki checks the folder every 5 seconds and
shows changes made by others (it pauses while the tab is in the background).
While you are editing, the **Live render** button does nothing; save or cancel
first to switch folders.

- While you edit, the wiki checks every 5 seconds whether someone else saved
  the same page. If they did, a banner says so and offers **Merge their changes
  into mine** and **Show what changed**. The banner stays at the top of the
  screen while you scroll, so you see it wherever on the page you are working.
  Nothing happens to your text until you click Merge. Chrome checks less often
  in background tabs, so in a tab you are not looking at the banner can be up
  to a minute late.
- Merging works on whole lines, like `git merge`: edits on different lines are
  combined, and the cursor stays on the line you were typing. Merging replaces
  the text box contents, so Ctrl Z cannot undo past it. While a clash waits for
  your choice, the editor toolbar is disabled too.
- If you both changed the same or neighbouring lines, each clash is shown with
  their lines and yours, and you pick **Keep mine**, **Keep theirs** or **Keep
  both**. The text box is read-only until every clash is decided. A paragraph is often
  one line in Markdown, so two edits to the same paragraph usually clash.
- **Save** merges the same way if someone saved since your last merge. If the
  edits clash, nothing is written, the page scrolls up to the clashes, and you
  choose as above, then save again.
- Two saves landing at nearly the same moment can still overwrite one another:
  there is no real locking without a server, and on a slow drive the
  unprotected moment lasts as long as the write itself.
- Merging is instant on wiki-sized pages. Its cost grows with the square of the
  stretch between someone's first and last changed line: an edit at the top and
  bottom of a 5,000-line page takes about 0.2 s and 100 MB of memory, of a
  10,000-line page about 0.7 s and 400 MB.
- Pages are saved as UTF-8 text without a byte-order mark. A page in another
  encoding (for example Windows "ANSI") cannot be edited here; convert it to
  UTF-8 first. If someone saves the page in another encoding while you edit
  it, Save refuses and keeps your text. The wiki recognises such pages by the
  character `�`, so a page that contains a literal `�` cannot be edited or
  saved over here either.
- A file with Windows line endings keeps them when saved.
- Leaving the page while editing discards unsaved changes.
- After a save, a note reminds you to re-run the build: what **Save** updates
  is the `.md` file, and wikis opened without live render read the bundled
  `data.js` snapshot, which only changes when the build script runs. It shows
  once per folder per tab — one build covers every save.
- Firefox and Safari cannot write to a folder, so they get no Edit button and
  only see the bundled `data.js` snapshot, which does not include edits until
  someone re-runs the build.
- Pages can contain HTML, and the wiki runs it as is. Anyone who can write to
  the folder can therefore run script in everyone else's browser, so share
  the folder only with people you trust.

## Settings

Local-first means settings live in the file, not in the UI. Edit `config.js`:

```javascript
window.WIKI = {
  maxResults: 200,   // maximum number of search results to display
  searchWidth: 50,   // results panel width as % of the window; 10–100 (full width at 760px and below)
  searchHeight: 60,  // results panel max height as % of the window; 10–100
  wikiName: 'Local Wiki', // shown in the topbar and as "Page — name" tab titles
  tocSide: 'left',   // 'left' (sidebar) or 'right' (rail beside the article)
  tocLevels: 3,      // heading levels shown in the TOC (H1..Hn); 1–6
  pageWidth: 70,     // article column width as % of the reading area; 10–100 (full width at 760px and below)
  foldersOpen: false, // start with the sidebar folders expanded (false = all collapsed)
  editButton: true,  // false hides the Edit button: live render reads the folder but never edits it
  landingPage: 'Home', // page opened on load (a slug like 'Guides/Basics'); '' = generated home
  sidebarOrder: 'files', // 'files' (pages then folders) | 'folders' | 'alpha' (mixed alphabetical)
  imageExts: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'], // images read in live-render mode; bundled mode needs no list — the browser paints any format
  // brandIcon: '📚',     // left out = built-in logo; any emoji/character replaces it; '' hides it
  favicon: '',            // tab icon: image file next to index.html, URL, or data: URI; '' = built-in logo
  expandOnPrint: true,    // open every fold section when printing; false keeps folds as you left them
  badgeColors: {     // first words of @{ badges } that get a color
    green: ['stable', 'ok', 'done', 'active', 'success', 'passed', 'shipped', 'final'],
    yellow: ['draft', 'wip', 'todo', 'pending', 'review', 'progress', 'untested'],
    red: ['error', 'failed', 'fails', 'failing', 'broken', 'danger', 'urgent', 'deprecated'],
    blue: ['info', 'new', 'beta', 'note', 'preview'],
    purple: ['alpha', 'experimental', 'planned', 'idea']
  }
};
```

Every key has a built-in default, so an older `config.js` keeps working when a new
version adds settings.

## Upgrading the wiki code

`config.js`, `user.css` and `articles/` are yours; everything else is the app.
Drop the new version on top of the folder (index.html, style.css, app.js,
build.sh/bat/ps1, vendor/), keep those three, then re-run the build. Style tweaks
go in `user.css`, which loads after `style.css` — override the `--bg`/`--accent`
etc. variables or any selector there instead of editing `style.css` (the edit box
is `.EasyMDEContainer .CodeMirror`, the toolbar `.editor-toolbar`). If you do
edit `style.css`, re-run the build: the page uses the copy inlined into `index.html`.

## Markdown conventions

Frontmatter (optional):

```yaml
---
title: My Page            # else: first H1, else filename
tags: one, two            # inline list — or a YAML list
---
```

Everything else is standard Markdown, plus:

````markdown
Inline math $a^2+b^2=c^2$, display math:

$$\int_0^1 x\,dx = \tfrac{1}{2}$$

```mermaid
graph LR
  A[Markdown] --> B[HTML]
```
````

A footnote.[^1]

[^1]: Written at the bottom of the file.

GitHub-style alerts (note, tip, important, warning, caution):

> [!NOTE]
> A boxed callout. A custom title after the marker is allowed.

Block containers (any name):

```
::: tip
Anything between the markers, styled by the name.
:::
```

Tab panels (button bar, first tab active by default):

````
::: tabs
::: tab: Node
```js
console.log('tabbed');
```
:::
::: tab: Python
```python
print('tabbed')
```
:::
:::
````

Foldable sections (collapsed behind a clickable title; `fold!` starts open, no title uses the browser's default label):

```
::: fold Implementation notes
Any Markdown inside, click the title to open or close.
:::
```

Inline badges (small pill, anything between `@{` and `}`; known statuses like `draft` or `stable` get a color — word list in the settings block):

```markdown
This page is @{draft} and the plugin is @{v1.0} stable.
```

Button links — any link prefixed with `@` renders as a button (works with `[[wiki links]]` too; an optional `{green|yellow|red|blue|purple}` suffix sets the fill color):

```markdown
@[Get started](Guides/Basics.md) @[[Advanced|see what's advanced]]
```


Link resolution:

- `[[Stem]]` (no slash) matches any file stem in the whole KB,
  case-insensitively; `[[Stem|alias]]` changes the displayed text. If
  several files share a stem, the shallowest one wins.
- `[[sub/name]]` (with a slash) is an exact path from the `articles/` root —
  no `..`, case-sensitive.
- Plain `.md` links are relative to the current page's folder
  (`./` and `../` work; a leading `/` is root-absolute), case-sensitive.

## How it works

```
articles/*.md ──build.sh──▶ data.js ─┐
                                     ├─▶ index.html + app.js (render in browser)
folder ──File System Access API──────┘
```

- `data.js` is a plain array of `{slug, mtime, content}` — content base64'd,
  decoded in JS. The build can stay trivial because titles/tags are parsed at
  load time, never at build time.
- `slug` is the page path relative to `articles/` and doubles as the URL
  fragment (`#Guides/Basics`).
- Render pipeline: frontmatter → `[[wiki]]`/`.md` link rewriting →
  markdown-it + footnotes → KaTeX auto-render → highlight.js → mermaid.
- All libraries are vendored in `vendor/` (single-file UMD builds, no dynamic
  imports) so the site never needs the internet. To upgrade a library,
  download its new release file and replace it — no build or install step.
  One exception: `vendor/mdit-extras.js` (the `:::` container + `> [!NOTE]`
  alert plugins, written against markdown-it's internal block-rule API) can
  break if you swap `markdown-it.min.js`; re-run `node test-render.js`
  after any vendor change.

## Project layout

```
index.html        the frame (layout + UI chrome, no logic)
style.css         styling source — the build inlines it, minified, into index.html
user.css          your style tweaks (loaded after style.css) — survives upgrades
config.js         your settings — survives upgrades
app.js            all logic: loaders, renderer, search, navigation
data.js           generated snapshot of articles/ (rebuild, don't edit)
build.sh          offline rebuild — bash
build.bat         offline rebuild — Windows (runs build.ps1)
build.ps1         offline rebuild — PowerShell
articles/         the knowledge base (sample pages included)
vendor/           markdown-it, mdit-extras, highlight.js, KaTeX (+fonts), mermaid, EasyMDE
test-render.js    smoke test: node test-render.js (run after upgrading vendor/)
test-app.js       smoke test: node test-app.js (link/footnote source passes)
```

## Limitations

- Live render: Chrome/Edge only; the remembered folder is per-browser and per-origin,
  and some Chrome builds on `file://` may re-ask for permission between sessions
- Search is substring matching — plenty for a local KB
- Bundled mode is a snapshot: new pages need a rebuild (or use live render)
- Bundled images are plain files: keep the `articles/` folder next to `index.html` (the wiki folder is the unit you copy or serve)
- `file:///…` refs (images/links outside `articles/`) only load when the wiki itself is opened via `file://`; browsers block them over `http(s)`. Out-of-KB `.md` links open as raw text — KB pages must live in `articles/`

## Disclaimer

This was developed with the help of a local LLM.
