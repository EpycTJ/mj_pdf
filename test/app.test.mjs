/**
 * Full-app integration test under jsdom.
 *
 *   node --import ./hooks.mjs app.test.mjs
 *
 * Boots the real js/main.js against the real index.html, then drives the
 * app like a user would: open the sample, page through, zoom, rotate,
 * search, toggle sidebar/panels/night mode — asserting DOM state at each
 * step. Canvas painting is mocked (see engine.mock.mjs); everything else
 * (layout math, search index, recents, wiring) is the real code.
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// ---------------------------------------------------------------- jsdom setup
const dom = new JSDOM(html, {
  url: 'http://localhost:8080/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});

const { window } = dom;

// jsdom gaps the app relies on
window.matchMedia = (q) => ({
  matches: false, media: q,
  addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {},
});
window.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
};
window.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
};

const props = [
  'document', 'navigator', 'location', 'history', 'localStorage',
  'matchMedia', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'CustomEvent',
  'KeyboardEvent', 'MouseEvent', 'InputEvent', 'Event', 'URL', 'IntersectionObserver',
  'ResizeObserver', 'screen',
];
for (const p of props) {
  if (window[p] !== undefined && globalThis[p] === undefined) {
    globalThis[p] = window[p];
  }
}
globalThis.window = window;
globalThis.document = window.document;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.devicePixelRatio = 1;

// jsdom has no canvas implementation — stub what the app + PDF.js TextLayer need
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,mock';
window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    canvas: this,
    _font: '12px sans-serif',
    set font(v) { this._font = v; },
    get font() { return this._font; },
    measureText: (s) => ({ width: String(s).length * 7 }),
    save() {}, restore() {},
  };
};
// jsdom doesn't implement Element.scrollTo (smooth scrolling API)
window.Element.prototype.scrollIntoView = function () {};
window.Element.prototype.scrollTo = function (arg) {
  this.scrollTop = typeof arg === 'number' ? arg : (arg?.top ?? 0);
};

// fetch: serve the sample from disk, fail everything else loudly
globalThis.fetch = async (url) => {
  if (String(url).includes('mj-pdf-guide.pdf')) {
    const bytes = readFileSync(new URL('../sample/mj-pdf-guide.pdf', import.meta.url));
    return new Response(bytes, { headers: { 'content-type': 'application/pdf' } });
  }
  throw new Error(`unexpected fetch in test: ${url}`);
};

// dialogs: jsdom's showModal throws without HTMLDialogElement support
if (!window.HTMLDialogElement?.prototype?.showModal) {
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
}

// ------------------------------------------------------------------- helpers
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const waitFor = async (fn, { timeout = 4000, step = 25 } = {}) => {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(step);
  }
};

// fake layout: jsdom has no layout engine
const viewport = () => $('#pagesViewport');
const fakeLayout = () => {
  const vp = viewport();
  Object.defineProperty(vp, 'clientWidth', { value: 1280, configurable: true });
  Object.defineProperty(vp, 'clientHeight', { value: 760, configurable: true });
  Object.defineProperty(vp, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(vp, 'clientTop', { value: 0, configurable: true });
};
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
  get() { return this._cw ?? 0; }, configurable: true,
});

// ---------------------------------------------------------------------- boot
const main = await import('../js/main.js');
fakeLayout();
await sleep(80);

check('boots to home screen', document.body.dataset.screen === 'home');
check('icons are mounted', document.querySelectorAll('[data-icon]').length === 0
  && document.querySelectorAll('svg').length > 10, `${document.querySelectorAll('svg').length} svgs`);
check('reader screen hidden', $('#readerScreen').hidden);

// ---------------------------------------------------------------- open sample
$('#openSampleBtn').click();
const opened = await waitFor(() => document.body.dataset.screen === 'reader');
check('sample opens the reader', opened);

await waitFor(() => $('#pagesStack').children.length === 8);
check('8 page slots built', $('#pagesStack').children.length === 8);

await waitFor(() => $('#docTitle').textContent.includes('Field Guide'));
check('document title from metadata', $('#docTitle').textContent.includes('Field Guide'));
check('page total shown', $('#pageTotal').textContent === '/ 8');
check('status meta shows size', $('#docMeta').textContent.length > 0, $('#docMeta').textContent);

await waitFor(() => $('.page.is-rendered'));
check('first page rendered', !!$('.page.is-rendered'));
check('scale factor set on page', parseFloat($('.page').style.getPropertyValue('--scale-factor')) > 0.5);
check('stack height computed', parseInt($('#pagesStack').style.height, 10) > 4000, $('#pagesStack').style.height);

// text layer (real PDF.js TextLayer with real text content)
await waitFor(() => $('.page .textLayer span'), { timeout: 5000 });
check('text layer spans built', document.querySelectorAll('.page .textLayer span').length > 5,
  `${document.querySelectorAll('.page .textLayer span').length} spans`);
check('text layer holds real text', /PDF|guide|viewer/i.test($('.page .textLayer').textContent || ''));

// zoom popover
$('#zoomModeBtn').click();
await sleep(60);
const zoomMenu = document.querySelector('.popover');
check('zoom popover opens', !!zoomMenu);
const fitItem = [...(zoomMenu?.querySelectorAll('.menu-item') || [])].find((b) => /Fit width/.test(b.textContent));
check('popover has fit-width item', !!fitItem);
fitItem?.click();
await sleep(240);  // popover removal is animated (~140ms)
check('popover closes after pick', !document.querySelector('.popover'));
check('fit width re-applied', /Fit width/.test($('#zoomChip').textContent), $('#zoomChip').textContent);

// fit-width math: (1280 - 64) / 595.28 ≈ 2.04 → ~204%
check('zoom chip shows fit width', /Fit width · 20\d%/.test($('#zoomChip').textContent), $('#zoomChip').textContent);

// --------------------------------------------------------------------- zoom
$('#zoomInBtn').click();
await sleep(60);
check('zoom in switches to percentage', /^\d+%$/.test($('#zoomModeBtn').textContent), $('#zoomModeBtn').textContent);
const wBefore = parseInt($('.page').style.width, 10);
$('#zoomOutBtn').click();
await sleep(60);
const wAfter = parseInt($('.page').style.width, 10);
check('zoom out shrinks pages', wAfter < wBefore, `${wBefore} → ${wAfter}`);

// ------------------------------------------------------------------- rotate
$('#rotateBtn').click();
await sleep(60);
check('rotation swaps page box', parseInt($('.page').style.width, 10) > parseInt($('.page').style.height, 10), `${$('.page').style.width} x ${$('.page').style.height}`);
$('#rotateBtn').click(); $('#rotateBtn').click(); $('#rotateBtn').click();
await sleep(60);

// ------------------------------------------------------------------ sidebar
$('#sidebarBtn').click();
await waitFor(() => !$('#sidebar').hidden);
check('sidebar opens', !$('#sidebar').hidden);
await waitFor(() => $('#thumbList').children.length === 8);
check('thumbnails built lazily', $('#thumbList').children.length === 8);
check('tab shows Pages active', $('#tabThumbs').getAttribute('aria-selected') === 'true');

$('#tabOutline').click();
await sleep(50);
check('outline tab switches', $('#outlinePane').hidden === false && $('#thumbsPane').hidden === true);
await waitFor(() => $('#outlineTree').children.length >= 8);
check('outline rows built from real TOC', $('#outlineTree').children.length === 8, `${$('#outlineTree').children.length} rows`);
check('outline titles render', /Opening documents/.test($('#outlineTree').textContent));

// ------------------------------------------------------------------- search
$('#searchBtn').click();
await sleep(30);
check('search bar opens', !$('#searchWrap').hidden);
const input = $('#searchInput');
input.value = 'typography';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
await waitFor(() => /\d+ matches/.test($('#searchCount').textContent), { timeout: 5000 });
check('search finds matches', /\d+ matches/.test($('#searchCount').textContent), $('#searchCount').textContent);
await waitFor(() => document.querySelector('.hl'));
check('highlights drawn', document.querySelectorAll('.hl').length > 0, `${document.querySelectorAll('.hl').length} rects`);

$('#searchNextBtn').click();
await sleep(120);
check('match counter steps', /\d+ \/ \d+/.test($('#searchCount').textContent), $('#searchCount').textContent);

$('#searchCloseBtn').click();
await sleep(30);
check('search closes and clears', $('#searchWrap').hidden && document.querySelectorAll('.hl').length === 0);

// ------------------------------------------------------------- page jumping
{
  const vp = viewport();
  vp.focus();
  const input = $('#pageInput');
  input.value = '5';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  // jsdom does not emit scroll events on scrollTop writes — emulate them
  vp.dispatchEvent(new window.Event('scroll', { bubbles: false }));
  await sleep(120);
  check('page input navigates', $('#pageInput').value === '5', `input=${$('#pageInput').value}`);
  vp.dispatchEvent(new window.Event('scroll', { bubbles: false }));
  await sleep(60);

  // keyboard: arrow keys page through
  vp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  vp.dispatchEvent(new window.Event('scroll', { bubbles: false }));
  await sleep(120);
  check('arrow key advances page', $('#pageInput').value === '6', `input=${$('#pageInput').value}`);
}

// -------------------------------------------------------------- night/theme
$('#nightBtn').click();
await sleep(20);
check('night pages toggles class', document.documentElement.classList.contains('night-pages'));
check('night button reflects state', $('#nightBtn').getAttribute('aria-pressed') === 'true');

$('#themeBtn').click();
await sleep(20);
const theme1 = document.documentElement.dataset.theme;
$('#themeBtn').click();
await sleep(20);
const theme2 = document.documentElement.dataset.theme;
check('theme cycles', theme1 !== theme2, `${theme1} → ${theme2}`);

// ------------------------------------------------------------------ recents
await sleep(150);
check('indexedDB available to the app', typeof indexedDB === 'object' && typeof indexedDB.open === 'function');

// ---------------------------------------------------------------- back home
$('#homeBtn').click();
await sleep(60);
check('back to home', document.body.dataset.screen === 'home' && $('#readerScreen').hidden);
await waitFor(() => !$('#recentsSection').hidden, { timeout: 4000 });
check('recents shelf shows the guide', /Field Guide/.test($('#recentsGrid').textContent));
check('recent card has progress bar', !!$('.recent-progress-fill'));

// reopen — should restore last page
$('.recent-card').click();
await waitFor(() => document.body.dataset.screen === 'reader');
await waitFor(() => $('#docTitle').textContent.includes('Field Guide'));
const rendered = await waitFor(() => !!$('.page.is-rendered'));
check('reopen from recents works', rendered);

console.log(failures ? `\n${failures} failure(s)` : '\nAll good.');
process.exit(failures ? 1 : 0);
