/**
 * MJ PDF Viewer — application shell
 *
 * Owns screen switching, theme + settings, and every way a document can
 * enter the app (picker, drag & drop, paste, link, deep link, recents,
 * sample). Delegates rendering to Reader and the shelf to Home.
 */

import { mountIcons } from './icons.js';
import { $, toast } from './util.js';
import { Home } from './home.js';
import { Reader } from './reader.js';
import { recents, sourceId } from './recents.js';

// ------------------------------------------------------------------ settings

const SETTINGS_KEY = 'mjpdf.settings.v1';
const DEFAULTS = { theme: 'auto', night: false, sidebar: false, pane: 'thumbs' };

const settings = { ...DEFAULTS, ...load() };
function load() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch { return {}; }
}
function persist() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

// -------------------------------------------------------------------- theme

const systemDark = matchMedia('(prefers-color-scheme: dark)');
let resolvedTheme = 'light';

function applyTheme() {
  resolvedTheme = settings.theme === 'auto'
    ? (systemDark.matches ? 'dark' : 'light')
    : settings.theme;
  document.documentElement.dataset.theme = resolvedTheme;
  for (const btn of [$('#homeThemeBtn'), reader?.el?.theme]) {
    if (!btn) continue;
    btn.title = `Theme: ${settings.theme}`;
  }
  themeListeners.forEach((fn) => fn());
}

const themeListeners = new Set();
function cycleTheme() {
  settings.theme = settings.theme === 'light' ? 'dark'
    : settings.theme === 'dark' ? 'auto' : 'light';
  persist();
  applyTheme();
  toast(`Theme: ${settings.theme}`, { timeout: 1100 });
}

systemDark.addEventListener('change', () => {
  if (settings.theme === 'auto') applyTheme();
});

// ------------------------------------------------------------------ the app

const app = {
  settings,

  getTheme: () => settings.theme,
  addThemeListener(fn) { themeListeners.add(fn); },
  persistSettings: persist,

  cycleTheme,

  isNight: () => settings.night,
  toggleNight() {
    settings.night = !settings.night;
    persist();
    document.documentElement.classList.toggle('night-pages', settings.night);
    toast(settings.night ? 'Night pages on' : 'Night pages off', { timeout: 1100 });
  },

  openFilePicker() {
    $('#fileInput').click();
  },

  showHome() {
    home.render();
  },
};

const home = new Home(openSource, app.getTheme, cycleTheme);
const reader = new Reader(app);
window._reader = reader; // debugging hook

// ------------------------------------------------------------- open plumbing

async function openSource(source) {
  try {
    switch (source.kind) {
      case 'file':
      case 'sample':
      case 'url': {
        reader.open(await prepare(source));
        return;
      }
      case 'recents': {
        const entry = source.entry;
        reader.open({
          id: entry.id,
          name: entry.name,
          size: entry.size,
          blob: entry.blob,
          savedPage: entry.lastPage,
        });
        return;
      }
      case 're-pick': {
        toast('Large file — pick it again to reopen (progress is kept)', { timeout: 2600 });
        $('#fileInput').click();
        return;
      }
      case 'url-dialog': {
        const url = await askUrl();
        if (url) openSource({ kind: 'url', url });
        return;
      }
    }
  } catch (err) {
    console.warn(err);
    toast(`Couldn’t open: ${err.message}`, { kind: 'error' });
  }
}

/** Normalize any source into what Reader.open expects. */
async function prepare(source) {
  if (source.kind === 'file') {
    return {
      id: sourceId(source.file),
      name: source.file.name,
      size: source.file.size,
      blob: source.file,
      source,
      savedPage: (await recents.get(sourceId(source.file)))?.lastPage,
    };
  }
  if (source.kind === 'sample') {
    const res = await fetch('sample/mj-pdf-guide.pdf');
    if (!res.ok) throw new Error(`sample missing (${res.status})`);
    const blob = await res.blob();
    return {
      id: 'sample:guide',
      name: 'The MJ PDF Field Guide.pdf',
      size: blob.size,
      blob,
      source,
      savedPage: (await recents.get('sample:guide'))?.lastPage,
    };
  }
  if (source.kind === 'url') {
    const { blob, finalUrl } = await fetchPdfFromUrl(source.url);
    return {
      id: `url:${finalUrl}`,
      name: decodeURIComponent(finalUrl.split('/').pop() || 'document.pdf').replace(/[?#].*$/, '') || 'document.pdf',
      size: blob.size,
      blob,
      source,
    };
  }
  throw new Error(`unknown source: ${source.kind}`);
}

async function fetchPdfFromUrl(url) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const blob = await res.blob();
  const type = blob.type || '';
  if (type && !/pdf/i.test(type)) {
    toast('That link did not return a PDF', { kind: 'error' });
    throw new Error('not a pdf');
  }
  return { blob, finalUrl: res.url || url };
}

// ------------------------------------------------------------------ dialogs

function askUrl() {
  const dlg = $('#urlDialog');
  const input = $('#urlInput');
  const error = $('#urlError');
  input.value = '';
  error.hidden = true;
  error.textContent = 'That link couldn’t be fetched. Cross-origin files must allow it (CORS).';

  return new Promise((resolve) => {
    const close = (value) => { dlg.close(); resolve(value); };

    const onCancel = () => close(null);
    $('#urlCancel').addEventListener('click', onCancel, { once: true });

    const onSubmit = (e) => {
      e.preventDefault();
      const value = input.value.trim();
      let parsed = null;
      try { parsed = new URL(value); } catch { /* not a URL */ }
      if (!parsed || !/^https?:$/.test(parsed.protocol)) {
        error.textContent = 'Please enter a full http(s) link to a PDF.';
        error.hidden = false;
        return;
      }
      close(parsed.href);   // fetch happens in the reader's loading overlay
    };
    $('#urlForm').addEventListener('submit', onSubmit);
    dlg.addEventListener('close', () => {
      $('#urlForm').removeEventListener('submit', onSubmit);
      resolve(null); // no-op if already resolved
    }, { once: true });

    dlg.showModal();
    input.focus();
  });
}

// ------------------------------------------------------ global input vectors

const fileInput = $('#fileInput');
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) handleFiles([file]);
});

function handleFiles(files) {
  const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length) {
    toast('No PDF in that drop', { kind: 'error' });
    return;
  }
  if (files.length > 1) {
    toast(`Opened “${pdfs[0].name}” — one at a time here`, { timeout: 2400 });
  }
  openSource({ kind: 'file', file: pdfs[0] });
}

// drag & drop anywhere
const veil = $('#dropVeil');
let dragDepth = 0;
addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  veil.hidden = false;
});
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; veil.hidden = true; }
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  veil.hidden = true;
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

// paste a file or a link
addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files || [])][0];
  if (file && (/pdf$/i.test(file.name) || file.type === 'application/pdf')) {
    handleFiles([file]);
    return;
  }
  const text = e.clipboardData?.getData('text')?.trim();
  if (text && /^https?:\/\/\S+\.pdf(\?\S*)?$/i.test(text) && document.body.dataset.screen === 'home') {
    openSource({ kind: 'url', url: text });
  }
});

// global open shortcut
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    fileInput.click();
  }
});

// ------------------------------------------------------------------ boot

function boot() {
  mountIcons();
  document.documentElement.classList.toggle('night-pages', settings.night);
  applyTheme();
  home.render();

  // deep link: ?file=<url>
  const target = new URLSearchParams(location.search).get('file');
  if (target) {
    openSource({ kind: 'url', url: target });
  }
}

boot();
