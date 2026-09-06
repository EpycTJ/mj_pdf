/**
 * MJ PDF Viewer — text search
 *
 * Streaming, case- and diacritic-insensitive search across the document.
 *
 *  • The index is built lazily, page by page, and results are yielded as
 *    they are found so the UI can count matches while still scanning.
 *  • Match rectangles are computed analytically from the text item
 *    transforms (user-space geometry), independent of any DOM, so they can
 *    be drawn before or without a text layer and re-projected at any
 *    zoom/rotation.
 */

// Unicode combining marks (diacritics) stripped by the fold.
const MARKS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff]/g;

/** Fold a single source char: NFKD → strip marks → lowercase. May expand. */
function foldChar(ch) {
  if (ch === ' ') return ' ';
  if (/\s/.test(ch)) return ' ';
  const folded = ch.normalize('NFKD').replace(MARKS, '');
  return folded ? folded.toLowerCase() : '';
}

/** Fold a query string and collapse whitespace. */
export function foldQuery(s) {
  return s.split(/\s+/).filter(Boolean).map((w) => [...w].map(foldChar).join('')).join(' ');
}

export class TextSearch {
  /** @param {import('./engine.js').Engine} engine */
  constructor(engine) {
    this.engine = engine;
    this.indexedUpTo = 0;
  }

  /** @type {Map<number, {norm: string, itemOf: Int32Array, origOf: Int32Array}>} */
  #index = new Map();

  reset() {
    this.#index.clear();
    this.indexedUpTo = 0;
  }

  /**
   * Build (or fetch) the folded character index of a page.
   * Parallel arrays map each folded char back to (item, original char idx).
   */
  async #pageIndex(n) {
    const cached = this.#index.get(n);
    if (cached) return cached;

    const items = await this.engine.textItems(n);
    let norm = '';
    const itemOf = [];
    const origOf = [];

    for (let i = 0; i < items.length; i++) {
      const str = items[i].str ?? '';
      for (let j = 0; j < str.length; j++) {
        const folded = foldChar(str[j]);
        for (const c of folded) {
          norm += c;
          itemOf.push(i);
          origOf.push(j);
        }
      }
    }

    const entry = { norm, itemOf: Int32Array.from(itemOf), origOf: Int32Array.from(origOf), items };
    this.#index.set(n, entry);
    return entry;
  }

  /**
   * Stream matches for `query`.
   * Yields { matches, scanned, done } — `matches` is the full list so far.
   */
  async *stream(query, signal) {
    const q = foldQuery(query);
    const total = this.engine.numPages;
    if (!q || !total) {
      yield { matches: [], scanned: 0, total, done: true };
      return;
    }

    const matches = [];
    for (let n = 1; n <= total; n++) {
      if (signal?.aborted) return;
      const { norm } = await this.#pageIndex(n);
      let at = norm.indexOf(q);
      while (at !== -1) {
        matches.push({ page: n, start: at, end: at + q.length });
        at = norm.indexOf(q, at + 1);
      }
      this.indexedUpTo = Math.max(this.indexedUpTo, n);
      yield { matches, scanned: n, total, done: n === total };
    }
  }

  /**
   * User-space rectangles for a match (one per text item it intersects).
   * Each rect is [x0, y0, x1, y1] in PDF user space at scale 1.
   */
  async matchRects(match) {
    const { items, itemOf, origOf } = await this.#pageIndex(match.page);

    const rects = [];
    let i = match.start;
    while (i < match.end) {
      const itemIdx = itemOf[i];
      const item = items[itemIdx];
      const str = item.str ?? '';
      const charAdv = str.length ? (item.width || 0) / str.length : 0;

      let j = i;
      while (j < match.end && itemOf[j] === itemIdx) j++;

      const firstChar = origOf[i];
      const lastChar = origOf[j - 1];
      const x0 = item.transform[4] + firstChar * charAdv;
      const x1 = item.transform[4] + (lastChar + 1) * charAdv;

      const fontSize = Math.hypot(item.transform[2], item.transform[3])
        || Math.abs(item.transform[0]) || item.height || 10;
      const y = item.transform[5];
      const pad = charAdv * 0.18 + 0.6;

      rects.push([x0 - pad, y - 0.24 * fontSize, x1 + pad, y + 0.8 * fontSize]);
      i = j;
    }
    return rects;
  }
}
