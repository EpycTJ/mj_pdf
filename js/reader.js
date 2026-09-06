/**
 * MJ PDF Viewer — reader screen
 *
 * Responsibilities:
 *   • document lifecycle: load (progress + password), render, close
 *   • virtualized page rendering with a priority queue and canvas eviction
 *     (only pages near the viewport are ever painted or kept in memory)
 *   • progressive page measurement for instant first paint on huge files
 *   • zoom / fit / rotate / night pages / fullscreen
 *   • thumbnails + outline sidebar, streaming search, reading progress
 *
 * The reader never touches the network and never blocks the UI thread on
 * PDF work — everything heavy goes to the PDF.js worker.
 */

import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { Engine, RenderCancelled } from './engine.js';
import { TextSearch } from './textSearch.js';
import { recents } from './recents.js';
import { icon } from './icons.js';
import {
  $, el, clamp, debounce, raf, toast, Popover, menuItem,
  fmtBytes, escapeHtml, reducedMotion, downloadBlob, MOD,
} from './util.js';

const FIT_WIDTH = 'width';
const FIT_PAGE = 'page';
const FIT_ZOOM = 'zoom';

const PAGE_GAP = 22;
const VIEW_PAD = 32;          // breathing room around pages
const PREFETCH = 2;           // pages rendered beyond the visible range
const EVICT_DISTANCE = 7;     // distance beyond which canvases are freed
const MAX_INFLIGHT = 2;       // concurrent page renders
const MEASURE_FIRST = 6;      // pages measured before first paint
const ZOOM_MIN = 25, ZOOM_MAX = 500;

const SHORTCUTS = [
  ['Open file', `${MOD}+O`],
  ['Search', '/'],
  ['Next / previous match', 'Enter / Shift+Enter'],
  ['Next / previous page', '→ / ←'],
  ['Scroll', '↑ ↓ Space'],
  ['Zoom in / out', '+ / −'],
  ['Fit width / fit page', 'W / H'],
  ['Actual size', '0'],
  ['Go to page', 'G'],
  ['Rotate', 'R'],
  ['Toggle sidebar', 'S'],
  ['Night pages', 'N'],
  ['Cycle theme', 'T'],
  ['Fullscreen', 'F'],
  ['Shortcuts', '?'],
];

export class Reader {
  // document state ---------------------------------------------------------
  /** @type {{id:string,name:string,size:number,blob:Blob,source?:object}|null} */
  doc = null;
  /** @type {Array} */ pages = [];
  generation = 0;               // invalidates async work after doc change
  inflight = new Set();

  // view state ---------------------------------------------------------------
  zoom = { mode: FIT_WIDTH, pct: 100 };
  scale = 1;
  curPage = 1;
  sidebarOpen = false;

  // search state -------------------------------------------------------------
  matches = [];
  matchIndex = -1;
  #searchAbort = null;
  #rectCache = new Map();       // `${page}:${matchIdx}` -> promise of rects
  #jumpedForQuery = null;

  // sidebar state ------------------------------------------------------------
  #thumbsBuilt = false;
  #thumbObserver = null;

  // zoom/more popover controllers
  #zoomPopover = null;
  #morePopover = null;

  /** @param {object} app — app services (see main.js) */
  constructor(app) {
    this.app = app;
    this.engine = new Engine();
    this.search = new TextSearch(this.engine);

    this.#dom();
    this.#wire();
    this.#popovers();
    this.#observeResize();
  }

  // =============================================================== DOM refs

  #dom() {
    const d = (id) => document.getElementById(id);
    this.el = {
      screen: d('readerScreen'),
      toolbar: d('toolbar'),
      viewport: d('pagesViewport'),
      stack: d('pagesStack'),
      overlay: d('readerOverlay'),
      overlayCard: d('overlayCard'),

      homeBtn: d('homeBtn'),
      sidebarBtn: d('sidebarBtn'),
      docTitle: d('docTitle'),
      docMeta: d('docMeta'),

      searchBtn: d('searchBtn'),
      searchWrap: d('searchWrap'),
      searchInput: d('searchInput'),
      searchCount: d('searchCount'),
      searchPrev: d('searchPrevBtn'),
      searchNext: d('searchNextBtn'),
      searchClose: d('searchCloseBtn'),

      zoomIn: d('zoomInBtn'),
      zoomOut: d('zoomOutBtn'),
      zoomMode: d('zoomModeBtn'),
      rotate: d('rotateBtn'),
      night: d('nightBtn'),
      theme: d('themeBtn'),
      more: d('moreBtn'),

      sidebar: d('sidebar'),
      tabThumbs: d('tabThumbs'),
      tabOutline: d('tabOutline'),
      thumbsPane: d('thumbsPane'),
      outlinePane: d('outlinePane'),
      thumbList: d('thumbList'),
      outlineTree: d('outlineTree'),
      outlineEmpty: d('outlineEmpty'),

      pageInput: d('pageInput'),
      pageTotal: d('pageTotal'),
      zoomChip: d('zoomChip'),
      sizeChip: d('sizeChip'),
      readProgress: d('readProgress'),
      passwordDialog: d('passwordDialog'),
    };
  }

  // ================================================================= wiring

  #wire() {
    const E = this.el;

    E.homeBtn.addEventListener('click', () => this.close());
    E.sidebarBtn.addEventListener('click', () => this.#toggleSidebar());

    E.tabThumbs.addEventListener('click', () => this.#switchPane('thumbs'));
    E.tabOutline.addEventListener('click', () => this.#switchPane('outline'));

    E.searchBtn.addEventListener('click', () => this.#openSearch());
    E.searchClose.addEventListener('click', () => this.#closeSearch());
    E.searchPrev.addEventListener('click', () => this.#stepMatch(-1));
    E.searchNext.addEventListener('click', () => this.#stepMatch(1));
    E.searchPrev.innerHTML = icon('chevron-up', { size: 16 });
    E.searchNext.innerHTML = icon('chevron-down', { size: 16 });
    E.searchClose.innerHTML = icon('x', { size: 16 });

    E.searchInput.addEventListener('input',
      debounce(() => this.#runSearch(), 200));
    E.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.#stepMatch(e.shiftKey ? -1 : 1);
      }
    });

    E.zoomIn.addEventListener('click', () => this.#zoomStep(1));
    E.zoomOut.addEventListener('click', () => this.#zoomStep(-1));
    E.zoomChip.addEventListener('click', () => this.#zoomPopover?.open());

    E.rotate.addEventListener('click', () => this.rotate());
    E.night.addEventListener('click', () => {
      this.app.toggleNight();
      this.#syncNight();
    });
    E.theme.addEventListener('click', () => this.app.cycleTheme());

    // scroll → schedule renders (rAF-coalesced, passive)
    E.viewport.addEventListener('scroll', () => this.#schedule(), { passive: true });

    // ctrl/⌘+wheel & trackpad pinch → zoom anchored under the pointer
    E.viewport.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.#wheelZoom(e);
    }, { passive: false });

    // page number field
    const commitPage = () => {
      const n = parseInt(E.pageInput.value.replace(/\D/g, ''), 10);
      if (Number.isFinite(n)) this.scrollToPage(clamp(n, 1, this.pages.length));
      this.#updateStatus();
    };
    E.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitPage(); E.pageInput.blur(); }
      if (e.key === 'Escape') { E.pageInput.value = this.curPage; E.pageInput.blur(); }
    });
    E.pageInput.addEventListener('blur', commitPage);
    E.pageInput.addEventListener('focus', () => E.pageInput.select());

    // keyboard shortcuts
    document.addEventListener('keydown', (e) => this.#onKey(e));

    // fullscreen chrome auto-hide
    document.addEventListener('fullscreenchange', () => {
      this.el.screen.classList.toggle('is-fullscreen', !!document.fullscreenElement);
      if (document.fullscreenElement) this.#armChromeHide();
      else this.#showChrome(true);
    });
    this.el.screen.addEventListener('pointermove', (e) => {
      if (!document.fullscreenElement) return;
      this.#showChrome(e.clientY < 80 || e.clientY > innerHeight - 80);
      this.#armChromeHide();
    });

    // save progress when leaving
    addEventListener('beforeunload', () => this.#saveProgressNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.#saveProgressNow();
    });

    this.app.addThemeListener(() => this.#syncThemeIcon());
    this.#syncThemeIcon();
    this.#syncNight();
  }

  #popovers() {
    const E = this.el;

    this.#zoomPopover = new Popover(E.zoomMode, (panel) => {
      const mode = this.zoom.mode;
      panel.append(
        menuItem({ icon: icon('fit-width', { size: 16 }), label: 'Fit width', hint: 'W', checked: mode === FIT_WIDTH, onClick: () => { this.#setFit(FIT_WIDTH); this.#zoomPopover.close(); } }),
        menuItem({ icon: icon('fit-page', { size: 16 }), label: 'Fit page', hint: 'H', checked: mode === FIT_PAGE, onClick: () => { this.#setFit(FIT_PAGE); this.#zoomPopover.close(); } }),
        menuItem({ icon: icon('zoom-out', { size: 16 }), label: 'Actual size', hint: '0', checked: mode === FIT_ZOOM && this.zoom.pct === 100, onClick: () => { this.#setZoomPct(100); this.#zoomPopover.close(); } }),
        el('div', { class: 'menu-sep' }),
      );
      for (const pct of [50, 75, 125, 150, 200, 300, 400]) {
        panel.append(menuItem({
          label: `${pct}%`,
          checked: mode === FIT_ZOOM && this.zoom.pct === pct,
          onClick: () => { this.#setZoomPct(pct); this.#zoomPopover.close(); },
        }));
      }
    }, { align: 'end' });

    this.#morePopover = new Popover(E.more, (panel) => {
      panel.append(
        menuItem({
          icon: icon(document.fullscreenElement ? 'shrink' : 'expand', { size: 16 }),
          label: document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen',
          hint: 'F',
          onClick: () => { this.#toggleFullscreen(); this.#morePopover.close(); },
        }),
        menuItem({
          icon: icon('download', { size: 16 }),
          label: 'Download original',
          onClick: () => {
            this.#morePopover.close();
            if (this.doc?.blob) downloadBlob(this.doc.blob, this.doc.name);
            else toast('This document was opened from a link and is no longer in memory', { kind: 'info' });
          },
        }),
        menuItem({
          icon: icon('keyboard', { size: 16 }),
          label: 'Keyboard shortcuts',
          hint: '?',
          onClick: () => { this.#morePopover.close(); this.#showShortcuts(); },
        }),
        el('div', { class: 'menu-sep' }),
        menuItem({
          icon: icon('info', { size: 16 }),
          label: 'About MJ PDF',
          onClick: () => {
            this.#morePopover.close();
            toast('MJ PDF Viewer — private, local, GPLv3. Built on PDF.js.', { timeout: 5000 });
          },
        }),
      );
    }, { align: 'end' });
  }

  #observeResize() {
    if ('ResizeObserver' in window) {
      let t;
      new ResizeObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => {
          if (!this.engine.ready) return;
          this.#layout({ keepAnchor: true });
          this.#schedule();
        }, 140);
      }).observe(this.el.viewport);
    }
  }

  // ============================================================ open/close

  /**
   * Open a prepared document.
   * @param {{id:string, name:string, size:number, blob:Blob, source?:object,
   *          savedPage?:number, thumb?:string}} prepared
   */
  async open(prepared) {
    this.#closeInternal();      // reset any previous document
    const gen = ++this.generation;

    // fresh view state per document (zoom/rotation don't leak across docs)
    this.zoom = { mode: FIT_WIDTH, pct: 100 };
    this.engine.rotation = 0;
    this.curPage = 1;

    this.doc = { ...prepared, title: null };
    this.el.screen.hidden = false;
    document.body.dataset.screen = 'reader';
    this.#showLoading(prepared.name, prepared.size);

    let buffer;
    try {
      buffer = await prepared.blob.arrayBuffer();
    } catch {
      this.#showError('Couldn’t read the file', 'The file may have been moved or deleted.', prepared);
      return;
    }

    try {
      await this.engine.open(
        { data: buffer },
        {
          onProgress: (loaded, total) => {
            if (gen !== this.generation) return;
            this.#updateLoadProgress(loaded, total, prepared.size);
          },
          onPassword: (reason) => this.#askPassword(reason),
        },
      );
    } catch (err) {
      if (gen !== this.generation) return;               // superseded or cancelled
      if (/password-cancelled/.test(err?.message || '')) {
        this.close();                                    // user gave up
        return;
      }
      this.#showError(
        err?.name === 'InvalidPDFException'
          ? 'This doesn’t look like a PDF'
          : 'Couldn’t open this document',
        err?.message || 'The file may be damaged or unsupported.',
        prepared,
      );
      return;
    }

    if (gen !== this.generation) return;
    await this.#finishOpen(prepared);
  }

  async #finishOpen(prepared) {
    const gen = this.generation;
    const meta = await this.engine.metadata().catch(() => ({}));
    if (gen !== this.generation) return;

    this.doc.title = meta.title || prepared.name.replace(/\.pdf$/i, '');
    this.el.docTitle.textContent = this.doc.title;
    this.el.docTitle.title = this.doc.title;
    this.el.sizeChip.textContent = fmtBytes(prepared.size);

    // ---- page model, measured progressively ------------------------------
    const n = this.engine.numPages;
    this.pages = Array.from({ length: n }, (_, i) => ({
      n: i + 1, baseW: 595, baseH: 842, w: 0, h: 0, top: 0,
      measured: false, el: null, canvas: null, textEl: null, hlEl: null,
      renderedKey: null, textKey: null, task: null,
    }));

    const first = Math.min(MEASURE_FIRST, n);
    for (let i = 0; i < first; i++) {
      const size = await this.engine.pageSize(i + 1);
      if (gen !== this.generation) return;
      Object.assign(this.pages[i], { baseW: size.width, baseH: size.height, measured: true });
    }

    // ---- layout & first paint --------------------------------------------
    this.el.overlay.hidden = true;
    this.#layout();
    const restored = clamp(prepared.savedPage || 1, 1, n);
    this.scrollToPage(restored, { instant: true });
    this.#schedule();

    // honor the persisted sidebar preference
    if (this.app.settings.sidebar && !this.sidebarOpen) this.#toggleSidebar(true);

    // background-measure the rest, keeping the reader anchored
    this.#measureRest(gen);

    // ---- sidebars, outline, recents ---------------------------------------
    this.#resetSidebar();
    this.search.reset();
    this.#buildOutline(gen);
    this.#registerRecent(prepared, n, restored, gen);

    this.el.pageInput.value = restored;
    this.#updateStatus();
  }

  async #measureRest(gen) {
    const median = this.#medianPageSize();
    for (const p of this.pages) {
      if (p.measured) continue;
      p.baseW = median.w; p.baseH = median.h;
    }
    if (this.pages.some((p) => !p.measured)) this.#layout({ keepAnchor: true });

    // measure one page at a time in the background — never blocks rendering
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p.measured) continue;
      if (gen !== this.generation) return;
      try {
        const size = await this.engine.pageSize(i + 1);
        if (gen !== this.generation) return;
        if (p.baseW !== size.width || p.baseH !== size.height) {
          p.baseW = size.width; p.baseH = size.height;
          if (i % 8 === 7) this.#layout({ keepAnchor: true });
        }
      } catch { /* keep estimate */ }
      p.measured = true;
    }
    this.#layout({ keepAnchor: true });
    this.#schedule();
  }

  #medianPageSize() {
    const ws = this.pages.filter((p) => p.measured).map((p) => p.baseW).sort((a, b) => a - b);
    const hs = this.pages.filter((p) => p.measured).map((p) => p.baseH).sort((a, b) => a - b);
    return { w: ws[Math.floor(ws.length / 2)] || 595, h: hs[Math.floor(hs.length / 2)] || 842 };
  }

  async #registerRecent(prepared, pageCount, page, gen) {
    const existing = await recents.get(prepared.id).catch(() => null);
    if (gen !== this.generation) return;
    await recents.put({
      id: prepared.id,
      name: prepared.name,
      size: prepared.size,
      openedAt: Date.now(),
      lastPage: page,
      pageCount,
      thumb: existing?.thumb,
      blob: prepared.blob,
    });

    // render a cover in the background
    if (!existing?.thumb) {
      try {
        const canvas = el('canvas');
        await this.engine.renderThumb(1, canvas, 132);
        if (gen !== this.generation) return;
        const thumb = canvas.toDataURL('image/jpeg', 0.72);
        await recents.patch(prepared.id, { thumb });
      } catch { /* cover is cosmetic */ }
    }
  }

  close() {
    this.#saveProgressNow();
    this.#closeInternal();
    document.body.dataset.screen = 'home';
    this.el.screen.hidden = true;
    this.app.showHome();
  }

  #closeInternal() {
    this.generation++;
    this.#cancelAllRenders();
    this.engine.destroy();
    this.pages = [];
    this.el.stack.replaceChildren();
    this.el.thumbList.replaceChildren();
    this.el.outlineTree.replaceChildren();
    this.el.overlay.hidden = true;
    this.#closeSearch();
    this.el.readProgress.style.width = '0';
    this.el.docTitle.textContent = '—';
    this.el.docMeta.textContent = '';
    this.el.pageTotal.textContent = '/ —';
    this.inflight.clear();
    if (this.#thumbObserver) { this.#thumbObserver.disconnect(); this.#thumbObserver = null; }
  }

  // ================================================================ overlays

  #showLoading(name, size) {
    const card = this.el.overlayCard;
    card.replaceChildren(
      el('div', { class: 'spinner', 'aria-hidden': 'true' }),
      el('h2', { class: 'overlay-title' }, escapeHtml(name)),
      el('p', { class: 'overlay-sub' }, size ? fmtBytes(size) : 'Loading…'),
      el('div', { class: 'load-bar' }, el('div', { class: 'load-bar-fill' })),
      el('button', { class: 'btn btn-sm overlay-cancel', onclick: () => this.close() }, 'Cancel'),
    );
    this.el.overlay.hidden = false;
  }

  #updateLoadProgress(loaded, total, fallbackTotal) {
    const t = total || fallbackTotal;
    const fill = this.el.overlayCard.querySelector('.load-bar-fill');
    if (fill && t) fill.style.width = `${clamp((loaded / t) * 100, 2, 100)}%`;
    const sub = this.el.overlayCard.querySelector('.overlay-sub');
    if (sub && t) sub.textContent = `${fmtBytes(loaded)} of ${fmtBytes(t)}`;
  }

  #showError(title, message, prepared) {
    const card = this.el.overlayCard;
    card.replaceChildren(
      el('div', { class: 'overlay-icon overlay-icon-error', html: icon('alert', { size: 26 }) }),
      el('h2', { class: 'overlay-title' }, title),
      el('p', { class: 'overlay-sub' }, message),
      el('div', { class: 'overlay-actions' }, [
        prepared && el('button', {
          class: 'btn btn-primary',
          onclick: () => this.open(prepared),
        }, 'Try again'),
        el('button', { class: 'btn', onclick: () => this.app.openFilePicker() }, 'Open another file'),
        el('button', { class: 'btn btn-ghost', onclick: () => this.close() }, 'Back to home'),
      ]),
    );
    this.el.overlay.hidden = false;
  }

  #askPassword(reason) {
    const dlg = this.el.passwordDialog;
    const input = $('#pwInput');
    const error = $('#pwError');
    error.hidden = reason !== 2;   // 2 = wrong password
    if (reason === 2) { input.value = ''; }

    return new Promise((resolve) => {
      const submit = $('#pwSubmit');
      const cancel = $('#pwCancel');
      const done = (value) => {
        dlg.close();
        resolve(value);
      };
      const onSubmit = (e) => { e.preventDefault(); done(input.value); };
      const onCancel = (e) => { e.preventDefault(); done(null); };
      const onClose = () => {
        submit.removeEventListener('click', onSubmit);
        cancel.removeEventListener('click', onCancel);
        dlg.removeEventListener('close', onClose);
        resolve(null);
      };
      submit.addEventListener('click', onSubmit, { once: true });
      cancel.addEventListener('click', onCancel, { once: true });
      dlg.addEventListener('close', onClose, { once: true });
      dlg.showModal();
      input.focus();
    });
  }

  #showShortcuts() {
    const grid = $('#shortcutGrid');
    grid.replaceChildren(...SHORTCUTS.map(([label, keys]) =>
      el('div', { class: 'shortcut-row' }, [
        el('span', { class: 'shortcut-label' }, label),
        el('kbd', { class: 'shortcut-key' }, keys),
      ]),
    ));
    const dlg = $('#shortcutsDialog');
    $('#scClose').onclick = () => dlg.close();
    dlg.showModal();
  }

  // ================================================================= layout

  #resolveScale() {
    const vpW = this.el.viewport.clientWidth - VIEW_PAD * 2;
    const vpH = this.el.viewport.clientHeight - VIEW_PAD * 2;
    if (vpW <= 0) return 1;

    // loop, not spread — page counts can reach the thousands
    let maxW = 1, maxH = 1;
    for (const p of this.pages) {
      if (p.baseW > maxW) maxW = p.baseW;
      if (p.baseH > maxH) maxH = p.baseH;
    }

    let scale;
    if (this.zoom.mode === FIT_ZOOM) {
      scale = this.zoom.pct / 100;
    } else {
      scale = vpW / maxW;
      if (this.zoom.mode === FIT_PAGE) scale = Math.min(scale, vpH / maxH);
    }
    return clamp(scale, 0.05, 12);
  }

  /** Compute page boxes and apply them to the DOM (synchronous). */
  #layout({ keepAnchor = false } = {}) {
    if (!this.pages.length) return;

    const anchor = keepAnchor ? this.#anchor() : null;
    this.scale = this.#resolveScale();

    const gap = PAGE_GAP;
    let top = VIEW_PAD;
    for (const p of this.pages) {
      p.w = Math.round(p.baseW * this.scale);
      p.h = Math.round(p.baseH * this.scale);
      p.top = top;
      top += p.h + gap;
    }
    const totalH = top - gap + VIEW_PAD;

    const stack = this.el.stack;
    stack.style.height = `${Math.ceil(totalH)}px`;

    for (const p of this.pages) {
      const div = p.el ?? this.#createPageEl(p);
      div.style.top = `${p.top}px`;
      div.style.width = `${p.w}px`;
      div.style.height = `${p.h}px`;
      div.style.setProperty('--scale-factor', this.scale);
    }

    if (anchor) this.#restoreAnchor(anchor);

    // zoom chip reflects the resolved scale
    const pct = Math.round(this.scale * 100);
    const label = this.zoom.mode === FIT_WIDTH ? 'Fit width'
      : this.zoom.mode === FIT_PAGE ? 'Fit page' : 'Zoom';
    this.el.zoomMode.textContent = `${pct}%`;
    this.el.zoomChip.textContent = `${label} · ${pct}%`;
  }

  #createPageEl(p) {
    const paper = el('div', { class: 'page-paper' });
    const canvas = el('canvas', { class: 'page-canvas', 'aria-label': `Page ${p.n}` });
    const textEl = el('div', { class: 'textLayer' });
    const hlEl = el('div', { class: 'hl-layer' });
    const num = el('div', { class: 'page-num' }, String(p.n));
    const spinner = el('div', { class: 'page-spinner' });

    paper.append(canvas, textEl, hlEl, spinner);
    const div = el('div', {
      class: 'page',
      dataset: { page: String(p.n) },
      role: 'region',
      'aria-label': `Page ${p.n}`,
    }, [paper, num]);
    this.el.stack.append(div);

    Object.assign(p, { el: div, paper, canvas, textEl, hlEl, spinner });
    return div;
  }

  /**
   * Capture the content point currently at 40% of the viewport height, so a
   * re-layout (zoom/rotate/resize) can keep it at the same screen position.
   */
  #anchor() {
    const vp = this.el.viewport;
    const screenY = vp.clientHeight * 0.4;
    const y = vp.scrollTop + screenY;
    const page = clamp(this.#pageAtY(y), 1, this.pages.length);
    const p = this.pages[page - 1];
    const frac = p && p.h > 0 ? clamp((y - p.top) / p.h, 0, 1) : 0;
    return { page, frac, screenY };
  }

  #restoreAnchor({ page, frac, screenY }) {
    const p = this.pages[page - 1];
    if (!p) return;
    this.el.viewport.scrollTop = Math.max(0, p.top + frac * p.h - screenY);
  }

  #pageAtY(y) {
    // binary search over tops
    let lo = 0, hi = this.pages.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.pages[mid].top <= y) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans + 1;
  }

  scrollToPage(n, { instant = false, center = false } = {}) {
    const p = this.pages[n - 1];
    if (!p) return;
    const vp = this.el.viewport;
    let target = p.top - VIEW_PAD * 0.35;
    if (center || p.h < vp.clientHeight - VIEW_PAD) {
      target = p.top + p.h / 2 - vp.clientHeight / 2;
    }
    vp.scrollTo({
      top: Math.max(0, target),
      behavior: instant || reducedMotion() ? 'auto' : 'smooth',
    });
  }

  // ======================================================== render pipeline

  #renderKey() {
    return `${this.scale.toFixed(3)}@${this.engine.rotation}`;
  }

  #visibleRange() {
    const vp = this.el.viewport;
    const top = vp.scrollTop - PAGE_GAP;
    const bottom = vp.scrollTop + vp.clientHeight + PAGE_GAP;
    const first = clamp(this.#pageAtY(Math.max(0, top)), 1, this.pages.length);
    const last = clamp(this.#pageAtY(bottom), 1, this.pages.length);
    return [first, last];
  }

  #schedule = raf(() => {
    if (!this.engine.ready) return;
    const [first, last] = this.#visibleRange();
    const key = this.#renderKey();

    // current page + status
    const mid = this.#pageAtY(this.el.viewport.scrollTop + this.el.viewport.clientHeight * 0.4);
    if (mid !== this.curPage) {
      this.curPage = mid;
      this.#updateStatus();
      this.#syncActiveThumb();
      this.#saveProgress();
    }

    // reading progress bar
    const sc = this.el.viewport;
    const scrollable = sc.scrollHeight - sc.clientHeight;
    this.el.readProgress.style.width = scrollable > 0
      ? `${clamp((sc.scrollTop / scrollable) * 100, 0, 100)}%` : '0%';

    // queue: visible pages by distance from current, then prefetch ring
    const wanted = [];
    for (let n = first; n <= last; n++) wanted.push(n);
    for (let d = 1; d <= PREFETCH; d++) {
      if (first - d >= 1) wanted.push(first - d);
      if (last + d <= this.pages.length) wanted.push(last + d);
    }
    wanted.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));

    for (const n of wanted) {
      const p = this.pages[n - 1];
      if (this.inflight.has(n)) continue;
      if (p.renderedKey === key && p.textKey === key) continue;
      if (this.inflight.size >= MAX_INFLIGHT) break;
      this.#renderPage(p, key);
    }

    // evict distant canvases to keep memory flat
    for (const p of this.pages) {
      if (!p.renderedKey) continue;
      if (p.n < first - EVICT_DISTANCE || p.n > last + EVICT_DISTANCE) {
        p.task?.cancel();
        p.renderedKey = null;
        p.textKey = null;
        p.canvas.width = 0;
        p.canvas.style.width = '0';
        p.canvas.style.height = '0';
        p.textEl.replaceChildren();
        p.hlEl.replaceChildren();
        p.el.classList.remove('is-rendered');
      }
    }
  });

  #renderPage(p, key) {
    this.inflight.add(p.n);
    p.el.classList.add('is-queued');

    const handle = this.engine.startRender(p.n, p.canvas, this.scale);
    p.task = handle;
    const gen = this.generation;

    handle.promise
      .then(() => {
        if (gen !== this.generation) return;
        p.renderedKey = key;
        p.el.classList.add('is-rendered');
        this.#drawHighlights(p);
        this.#attachTextLayer(p, key);
      })
      .catch((err) => {
        if (!(err instanceof RenderCancelled)) console.warn('render failed', p.n, err);
      })
      .finally(() => {
        this.inflight.delete(p.n);
        p.el.classList.remove('is-queued');
        if (gen === this.generation) this.#schedule();
      });
  }

  async #attachTextLayer(p, key) {
    if (p.textKey === key) return;
    const gen = this.generation;
    try {
      const source = await this.engine.textLayerSource(p.n);
      const viewport = await this.engine.viewport(p.n, this.scale);
      if (gen !== this.generation || p.renderedKey !== key) return;

      p.textEl.replaceChildren();
      const layer = new pdfjs.TextLayer({
        textContentSource: source,
        container: p.textEl,
        viewport,
      });
      await layer.render();
      if (gen !== this.generation) { p.textEl.replaceChildren(); return; }
      p.textKey = key;
    } catch (err) {
      if (String(err).includes('RenderingCancelledException')) return;
      // text layer is a nice-to-have; never surface this to the user
      console.debug('text layer skipped', p.n, err);
    }
  }

  #cancelAllRenders() {
    for (const p of this.pages) p.task?.cancel();
    this.inflight.clear();
  }

  // =================================================================== zoom

  #setFit(mode) {
    this.zoom.mode = mode;
    this.#layout({ keepAnchor: true });
    this.#schedule();
  }

  #setZoomPct(pct) {
    this.zoom = { mode: FIT_ZOOM, pct: clamp(pct, ZOOM_MIN, ZOOM_MAX) };
    this.#layout({ keepAnchor: true });
    this.#schedule();
  }

  #zoomStep(dir) {
    const current = Math.round(this.scale * 100);
    const next = dir > 0 ? current * 1.2 : current / 1.2;
    this.#setZoomPct(Math.round(next));
  }

  #wheelZoom(e) {
    const vp = this.el.viewport;
    const rect = vp.getBoundingClientRect();
    const py = e.clientY - rect.top;

    const yBefore = vp.scrollTop + py;
    const pageBefore = this.#pageAtY(yBefore);
    const offsetBefore = yBefore - this.pages[pageBefore - 1].top;
    const scaleBefore = this.scale;

    this.#zoomStep(e.deltaY < 0 ? 1 : -1);

    const p = this.pages[pageBefore - 1];
    if (p) {
      const grown = this.scale / scaleBefore;
      vp.scrollTop = p.top + offsetBefore * grown - py;
    }
    this.#schedule();
  }

  rotate() {
    if (!this.engine.ready) return;
    this.engine.rotation = (this.engine.rotation + 90) % 360;
    // A 90° step swaps every page's displayed box — cheap, exact, instant.
    for (const p of this.pages) {
      [p.baseW, p.baseH] = [p.baseH, p.baseW];
    }
    this.#layout({ keepAnchor: true });
    this.#schedule();
    // % -positioned highlights were projected with the old rotation
    for (const p of this.pages) if (p.renderedKey) this.#drawHighlights(p);
    toast(`Rotated ${this.engine.rotation}°`, { timeout: 1200 });
  }

  // ============================================================ night/theme

  #syncNight() {
    const on = this.app.isNight();
    this.el.night.setAttribute('aria-pressed', String(on));
    this.el.night.classList.toggle('is-on', on);
  }

  #syncThemeIcon() {
    const mode = this.app.getTheme();
    const name = mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'contrast';
    this.el.theme.innerHTML = icon(name);
    this.el.theme.title = `Theme: ${mode}`;
  }

  // ================================================================ sidebar

  #toggleSidebar(force) {
    this.sidebarOpen = force ?? !this.sidebarOpen;
    this.el.sidebar.hidden = !this.sidebarOpen;
    this.el.sidebarBtn.setAttribute('aria-pressed', String(this.sidebarOpen));
    this.el.sidebarBtn.classList.toggle('is-on', this.sidebarOpen);
    this.app.settings.sidebar = this.sidebarOpen;
    this.app.persistSettings();
    if (this.sidebarOpen) {
      this.#ensureThumbs();
      this.#syncActiveThumb({ scroll: true });
    }
    // reflow after the sidebar animation settles
    setTimeout(() => { if (this.engine.ready) { this.#layout({ keepAnchor: true }); this.#schedule(); } }, 60);
  }

  #switchPane(pane) {
    this.el.tabThumbs.setAttribute('aria-selected', String(pane === 'thumbs'));
    this.el.tabOutline.setAttribute('aria-selected', String(pane === 'outline'));
    this.el.thumbsPane.hidden = pane !== 'thumbs';
    this.el.outlinePane.hidden = pane !== 'outline';
    this.app.settings.pane = pane;
    if (pane === 'thumbs') this.#ensureThumbs();
  }

  #resetSidebar() {
    this.el.thumbList.replaceChildren();
    this.#thumbObserver?.disconnect();
    this.#thumbObserver = null;
    this.#thumbsBuilt = false;
    if (this.sidebarOpen) {
      const pane = this.app.settings.pane || 'thumbs';
      this.#switchPane(pane);
      if (pane === 'thumbs') this.#ensureThumbs();
    }
  }

  #ensureThumbs() {
    if (this.#thumbsBuilt || !this.pages.length) return;
    this.#thumbsBuilt = true;

    const list = this.el.thumbList;
    const thumbW = 104;
    const slots = this.pages.map((p) => {
      const slot = el('button', {
        class: 'thumb',
        type: 'button',
        dataset: { page: String(p.n) },
        'aria-label': `Go to page ${p.n}`,
      }, [
        el('div', { class: 'thumb-box', style: `aspect-ratio:${p.baseW} / ${p.baseH}` }, [
          el('canvas', { class: 'thumb-canvas' }),
        ]),
        el('span', { class: 'thumb-num' }, String(p.n)),
      ]);
      slot.addEventListener('click', () => this.scrollToPage(p.n));
      list.append(slot);
      return slot;
    });

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const n = Number(entry.target.dataset.page);
        this.#renderThumbSlot(n, entry.target, thumbW);
      }
    }, { root: this.el.thumbsPane, rootMargin: '160px' });
    slots.forEach((s) => io.observe(s));
    this.#thumbObserver = io;
  }

  async #renderThumbSlot(n, slot, width) {
    const gen = this.generation;
    const canvas = slot.querySelector('.thumb-canvas');
    try {
      await this.engine.renderThumb(n, canvas, width);
      if (gen !== this.generation) return;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      slot.classList.add('is-rendered');
    } catch { /* thumbnail is cosmetic */ }
  }

  #syncActiveThumb({ scroll = false } = {}) {
    const active = this.el.thumbList.querySelector('.thumb.is-active');
    active?.classList.remove('is-active');
    const next = this.el.thumbList.querySelector(`.thumb[data-page="${this.curPage}"]`);
    if (next) {
      next.classList.add('is-active');
      if (scroll) next.scrollIntoView({ block: 'nearest' });
    }
  }

  async #buildOutline(gen) {
    const outline = await this.engine.outline().catch(() => []);
    if (gen !== this.generation) return;

    const tree = this.el.outlineTree;
    tree.replaceChildren();
    const count = (items) => items.reduce((sum, it) => 1 + count(it.children || []), 0);
    this.el.outlineEmpty.hidden = outline.length > 0;
    if (!outline.length) return;

    const build = (items, depth) => {
      for (const item of items) {
        const row = el('button', {
          class: 'outline-row',
          type: 'button',
          style: `--depth:${depth}`,
          disabled: item.page == null ? 'true' : null,
        }, [
          el('span', { class: 'outline-label' }, item.title),
          item.page != null ? el('span', { class: 'outline-page' }, String(item.page)) : null,
        ]);
        if (item.page != null) {
          row.addEventListener('click', () => this.scrollToPage(item.page, { center: true }));
        }
        tree.append(row);
        if (item.children?.length) build(item.children, depth + 1);
      }
    };
    build(outline, 0);
    void count;
  }

  // ================================================================= search

  #openSearch() {
    this.el.searchWrap.hidden = false;
    this.el.searchBtn.classList.add('is-on');
    this.el.searchInput.focus();
    this.el.searchInput.select();
  }

  #closeSearch() {
    this.el.searchWrap.hidden = true;
    this.el.searchBtn.classList.remove('is-on');
    this.matches = [];
    this.matchIndex = -1;
    this.#searchAbort?.abort();
    this.#rectCache.clear();
    for (const p of this.pages) p.hlEl?.replaceChildren();
    this.el.searchInput.value = '';
    this.el.searchCount.textContent = '';
    this.el.searchInput.classList.remove('is-empty');
  }

  async #runSearch() {
    const query = this.el.searchInput.value.trim();
    this.#searchAbort?.abort();
    const ctrl = new AbortController();
    this.#searchAbort = ctrl;
    this.#rectCache.clear();
    this.#jumpedForQuery = null;

    if (!query) {
      this.matches = [];
      this.matchIndex = -1;
      for (const p of this.pages) p.hlEl?.replaceChildren();
      this.el.searchCount.textContent = '';
      this.el.searchInput.classList.remove('is-empty');
      return;
    }

    const gen = this.generation;
    this.el.searchCount.textContent = '…';
    this.el.searchInput.classList.remove('is-empty');

    try {
      for await (const res of this.search.stream(query, ctrl.signal)) {
        if (gen !== this.generation || ctrl.signal.aborted) return;
        this.matches = res.matches;
        if (this.matchIndex === -1 && this.matches.length) this.matchIndex = 0;

        if (res.done) {
          this.el.searchCount.textContent = this.matches.length
            ? `${this.matches.length} ${this.matches.length === 1 ? 'match' : 'matches'}`
            : '0 matches';
          this.el.searchInput.classList.toggle('is-empty', this.matches.length === 0);
        } else {
          this.el.searchCount.textContent = `${this.matches.length}+`;
        }

        // draw what is already on screen
        for (const p of this.pages) {
          if (p.renderedKey) this.#drawHighlights(p);
        }

        // jump once when the first result of a fresh query arrives
        if (this.#jumpedForQuery !== query && this.matches.length) {
          this.#jumpedForQuery = query;
          this.#gotoMatch(0);
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) console.warn('search failed', err);
    }
  }

  #stepMatch(dir) {
    if (!this.matches.length) return;
    const next = (this.matchIndex + dir + this.matches.length) % this.matches.length;
    this.#gotoMatch(next);
  }

  async #gotoMatch(index) {
    this.matchIndex = index;
    const match = this.matches[index];
    if (!match) return;

    this.el.searchCount.textContent = `${index + 1} / ${this.matches.length}`;
    this.scrollToPage(match.page, { center: true });

    // make sure the page is rendered, then paint highlights with the active one
    const gen = this.generation;
    await this.#waitForRender(match.page);
    if (gen !== this.generation) return;
    const p = this.pages[match.page - 1];
    if (p) this.#drawHighlights(p);
  }

  #waitForRender(n, timeoutMs = 3000) {
    const gen = this.generation;
    return new Promise((resolve) => {
      const done = () => {
        clearInterval(t); clearTimeout(giveUp); resolve();
      };
      const check = () => {
        if (this.generation !== gen) return done();
        const p = this.pages[n - 1];
        if (!p || p.renderedKey === this.#renderKey()) done();
      };
      const t = setInterval(check, 80);
      const giveUp = setTimeout(done, timeoutMs);
      check();
    });
  }

  async #drawHighlights(p) {
    const onPage = [];
    for (let i = 0; i < this.matches.length; i++) {
      if (this.matches[i].page === p.n) onPage.push(i);
    }
    p.hlEl.replaceChildren();
    if (!onPage.length) return;

    const gen = this.generation;
    const viewport = await this.engine.viewport(p.n, this.scale);
    if (gen !== this.generation) return;

    for (const i of onPage) {
      const cacheKey = `${p.n}:${i}`;
      if (!this.#rectCache.has(cacheKey)) {
        this.#rectCache.set(cacheKey, this.search.matchRects(this.matches[i]));
      }
      const rects = await this.#rectCache.get(cacheKey);
      if (gen !== this.generation) return;

      for (const [x0, y0, x1, y1] of rects) {
        // Util.applyTransform mutates the point in place and returns nothing
        const a = [x0, y0];
        const b = [x1, y1];
        pdfjs.Util.applyTransform(a, viewport.transform);
        pdfjs.Util.applyTransform(b, viewport.transform);
        const left = Math.min(a[0], b[0]) / viewport.width;
        const right = Math.max(a[0], b[0]) / viewport.width;
        const top = Math.min(a[1], b[1]) / viewport.height;
        const bottom = Math.max(a[1], b[1]) / viewport.height;
        p.hlEl.append(el('div', {
          class: `hl${i === this.matchIndex ? ' hl-active' : ''}`,
          style: `left:${(left * 100).toFixed(2)}%;top:${(top * 100).toFixed(2)}%;` +
                 `width:${((right - left) * 100).toFixed(2)}%;height:${((bottom - top) * 100).toFixed(2)}%`,
        }));
      }
    }
  }

  // ================================================================= status

  #updateStatus() {
    this.el.pageInput.value = this.curPage;
    this.el.pageTotal.textContent = `/ ${this.pages.length || '—'}`;
    this.el.docMeta.textContent = this.pages.length
      ? `${fmtBytes(this.doc?.size)} · page ${this.curPage} of ${this.pages.length}`
      : fmtBytes(this.doc?.size);
  }

  #saveProgress = debounce(() => this.#saveProgressNow(), 700);

  #saveProgressNow() {
    if (this.doc?.id && this.pages.length) {
      recents.patch(this.doc.id, { lastPage: this.curPage }).catch(() => {});
    }
  }

  // ============================================================== fullscreen

  #toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.el.screen.requestFullscreen?.().catch(() => {});
  }

  #chromeTimer = null;
  #armChromeHide() {
    clearTimeout(this.#chromeTimer);
    this.#chromeTimer = setTimeout(() => this.#showChrome(false), 1800);
  }

  #showChrome(show) {
    this.el.screen.classList.toggle('chrome-hidden', !show);
  }

  // ================================================================ keyboard

  #onKey(e) {
    if (document.body.dataset.screen !== 'reader') return;

    const inField = e.target.matches('input, textarea, select, [contenteditable]');
    const dlgOpen = document.querySelector('dialog[open]');
    if (dlgOpen || (inField && e.key !== 'Escape')) return;

    const stop = () => { e.preventDefault(); e.stopPropagation(); };

    // Ctrl/Cmd combos
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'f' && !e.shiftKey) { stop(); this.#openSearch(); return; }
      return; // let browser shortcuts through
    }

    switch (e.key) {
      case 'ArrowRight': case 'PageDown': stop(); this.scrollToPage(this.curPage + 1); break;
      case 'ArrowLeft': case 'PageUp': stop(); this.scrollToPage(this.curPage - 1); break;
      case 'Home': stop(); this.scrollToPage(1); break;
      case 'End': stop(); this.scrollToPage(this.pages.length); break;
      case '+': case '=': stop(); this.#zoomStep(1); break;
      case '-': case '_': stop(); this.#zoomStep(-1); break;
      case '0': stop(); this.#setZoomPct(100); break;
      case '/': stop(); this.#openSearch(); break;
      case '?': stop(); this.#showShortcuts(); break;
      case 'Escape':
        if (!this.el.searchWrap.hidden) { stop(); this.#closeSearch(); }
        break;
      default:
        if (e.repeat) return;
        switch (e.key.toLowerCase()) {
          case 'w': stop(); this.#setFit(FIT_WIDTH); break;
          case 'h': stop(); this.#setFit(FIT_PAGE); break;
          case 'g': stop(); this.el.pageInput.focus(); break;
          case 'r': stop(); this.rotate(); break;
          case 's': stop(); this.#toggleSidebar(); break;
          case 'n': stop(); this.app.toggleNight(); this.#syncNight(); break;
          case 't': stop(); this.app.cycleTheme(); break;
          case 'f': stop(); this.#toggleFullscreen(); break;
        }
    }
  }
}
