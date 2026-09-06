/**
 * MJ PDF Viewer — home screen
 * Hero + recent documents shelf. Renders lazily from IndexedDB.
 */

import { icon, } from './icons.js';
import { el, $, fmtBytes, fmtAgo, truncate, toast } from './util.js';
import { recents } from './recents.js';

export class Home {
  /** @type {Array} */ #cache = [];

  /**
   * @param {(source: object) => void} open  — hand an open-request to the app
   * @param {() => 'light'|'dark'|'auto'} getTheme
   * @param {() => void} cycleTheme
   */
  constructor(open, getTheme, cycleTheme) {
    this.open = open;
    this.getTheme = getTheme;
    this.cycleTheme = cycleTheme;
    this.#wire();
  }

  #wire() {
    $('#openFileBtn').addEventListener('click', () => $('#fileInput').click());
    $('#openSampleBtn').addEventListener('click', () =>
      this.open({ kind: 'sample' }));
    $('#openUrlBtn').addEventListener('click', () => this.open({ kind: 'url-dialog' }));
    $('#clearRecentsBtn').addEventListener('click', async () => {
      await recents.clear();
      this.render();
      toast('Reading history cleared', { kind: 'ok' });
    });
    $('#homeThemeBtn').addEventListener('click', () => {
      cycleTheme();
      this.#syncThemeIcon();
    });
  }

  #syncThemeIcon() {
    const mode = this.getTheme();
    const name = mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'contrast';
    $('#homeThemeBtn').innerHTML = icon(name);
    $('#homeThemeBtn').title = `Theme: ${mode}`;
  }

  /** Refresh the recents shelf (called on boot and whenever we come home). */
  async render() {
    this.#syncThemeIcon();
    const entries = await recents.list().catch(() => []);
    this.#cache = entries;

    const section = $('#recentsSection');
    const grid = $('#recentsGrid');
    grid.replaceChildren();

    if (!entries.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    for (const entry of entries) {
      grid.append(this.#card(entry));
    }
  }

  #card(entry) {
    const progress = entry.pageCount
      ? Math.min(100, Math.round(((entry.lastPage || 1) / entry.pageCount) * 100))
      : null;

    const cover = entry.thumb
      ? el('img', { class: 'recent-cover-img', src: entry.thumb, alt: '', loading: 'lazy' })
      : el('span', { class: 'recent-cover-fallback', html: icon('file', { size: 30 }) });

    const card = el('button', {
      class: 'recent-card',
      type: 'button',
      title: entry.blob ? `Open “${entry.name}”` : `Re-open “${entry.name}” (file must be picked again)`,
    }, [
      el('div', { class: 'recent-cover' }, [cover]),
      el('div', { class: 'recent-body' }, [
        el('div', { class: 'recent-name' }, truncate(entry.name || 'Untitled', 64)),
        el('div', { class: 'recent-meta' }, [
          `${entry.pageCount ? `${entry.pageCount} pages · ` : ''}${fmtBytes(entry.size)}`,
          el('span', { class: 'recent-dot' }, '·'),
          fmtAgo(entry.openedAt),
        ]),
        progress != null && progress > 0
          ? el('div', { class: 'recent-progress' }, [
              el('div', { class: 'recent-progress-fill', style: `width:${progress}%` }),
            ])
          : null,
        entry.blobDropped || !entry.blob
          ? el('div', { class: 'recent-flag', title: 'Large file — pick it again to reopen' }, 'needs re-pick')
          : null,
      ]),
      el('span', {
        class: 'recent-remove',
        role: 'button',
        title: 'Remove from history',
        'aria-label': `Remove ${entry.name} from history`,
        html: icon('x', { size: 14 }),
      }),
    ]);

    card.addEventListener('click', (e) => {
      if (e.target.closest('.recent-remove')) {
        e.stopPropagation();
        recents.remove(entry.id).then(() => this.render());
        return;
      }
      if (entry.blob) {
        this.open({ kind: 'recents', entry });
      } else {
        this.open({ kind: 're-pick', entry });
      }
    });

    return card;
  }
}
