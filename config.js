/* ══════════════ SETTINGS (edit me) ══════════════
   Local-first: your settings live here, in this file — not in the UI.
   This file and articles/ are YOURS: a wiki upgrade replaces everything
   else, so keep these and nothing is lost. Missing keys fall back to the
   app's built-in defaults, so an old config still works with a new version.

   maxResults  : maximum number of search results to display
   searchWidth : search results panel width, percent of the window — 10 to 100
   searchHeight : search results panel max height, percent of the window — 10 to 100
   wikiName    : name shown in the topbar and the browser tab title
   tocSide     : where the table of contents is shown — 'left' (sidebar) or 'right' (rail)
   tocLevels   : heading levels shown in the TOC (H1..Hn) — 1 to 6
   pageWidth   : article column width, percent of the reading area — 10 to 100
   foldersOpen : start with the sidebar folders expanded (false = all collapsed)
   imageExts   : extensions read as images in live-render mode (bundled mode needs no list, the browser paints any format)
   brandIcon   : icon before the wiki name in the topbar — left out = built-in logo; any emoji/character replaces it; '' hides it
   favicon     : tab icon — image file next to index.html, URL, or data: URI; '' = the built-in logo
   expandOnPrint : open every ::: fold section when printing (false keeps them closed)
   badgeColors : which first-words color inline @{ badges }
   landingPage : page opened on load (slug like 'Guides/Basics'); '' = generated home
   sidebarOrder: how the sidebar lists pages vs folders — 'files' | 'folders' | 'alpha' */
window.WIKI = {
  maxResults: 200,
  searchWidth: 50, // search results panel width as % of the window; 10–100 (panel is centred under the topbar)
  searchHeight: 60, // search results panel max height as % of the window; 10–100 (panel scrolls past that)
  wikiName: 'Local Wiki', // shown in the topbar (after the icon) and as "Page — name" tab titles
  tocSide: 'left',
  tocLevels: 3, // heading levels shown in the TOC (H1..Hn); 1–6
  pageWidth: 70, // article column width as % of the reading area; 10–100
  foldersOpen: false,
  landingPage: 'Home', // page opened on load; '' shows the generated home (recent + folders)
  sidebarOrder: 'files', // 'files' (pages then folders) | 'folders' (folders then pages) | 'alpha' (mixed alphabetical)
  imageExts: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'], // live-render mode only; add e.g. 'bmp' or 'avif' if your browser supports it
  // brandIcon: '📚', // left out = the built-in logo; any emoji/character replaces it; '' hides it; for an image, go to user.css
  favicon: '', // browser tab icon: image file next to index.html (keep it — it's yours, like this file), any URL, or a data: URI; '' = the built-in logo
  expandOnPrint: true, // printing opens every fold section so nothing is hidden on paper; false keeps folds as you left them
  // first word of a badge → its color, matched case-insensitively; unknown words stay the gray pill
  badgeColors: {
    green:  ['stable', 'ok', 'done', 'active', 'success', 'passed', 'shipped', 'final'],
    yellow: ['draft', 'wip', 'todo', 'pending', 'review', 'progress', 'untested'],
    red:    ['error', 'failed', 'fails', 'failing', 'broken', 'danger', 'urgent', 'deprecated'],
    blue:   ['info', 'new', 'beta', 'note', 'preview'],
    purple: ['alpha', 'experimental', 'planned', 'idea']
  }
};
