/**
 * MJ PDF Viewer — PDF engine
 *
 * A thin, opinionated wrapper around PDF.js:
 *   • rendering happens inside a dedicated Web Worker (never on the UI thread)
 *   • opening supports progress reporting and password retry
 *   • page geometry, text and outlines are exposed as cached promises so
 *     callers can fire-and-await freely without duplicate work
 */

import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  '../vendor/pdfjs/pdf.worker.min.mjs',
  import.meta.url,
).href;

// Standard-14 font data (needed whenever a PDF relies on Helvetica & co)
// and CMaps for CJK documents — vendored so everything works offline.
const standardFontDataUrl = new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href;
const cMapUrl = new URL('../vendor/pdfjs/cmaps/', import.meta.url).href;

/** Cap the render resolution so one huge zoom can't exhaust canvas memory. */
const MAX_CANVAS_PIXELS = 2 ** 24; // ~16.7 MP per page

export class RenderCancelled extends Error {
  constructor() { super('render cancelled'); this.name = 'RenderCancelled'; }
}

export class Engine {
  /** @type {Map<number, Array>} page number -> text items */
  #textCache = new Map();

  constructor() {
    this.doc = null;
    this.loadingTask = null;
    this.rotation = 0;          // viewer-level rotation (0/90/180/270)
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Open a document.
   * @param {{data?: ArrayBuffer|Uint8Array, url?: string}} source
   * @param {{onProgress?: (loaded:number,total:number)=>void,
   *          onPassword?: (reason:number)=>Promise<string|null>}} hooks
   */
  async open(source, hooks = {}) {
    if (this.loadingTask) this.destroy();

    const params = {
      isEvalSupported: false,
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true,
    };
    if (source.data) {
      params.data = source.data instanceof Uint8Array
        ? source.data
        : new Uint8Array(source.data);
    } else if (source.url) {
      params.url = source.url;
    }

    const task = pdfjs.getDocument(params);
    this.loadingTask = task;

    task.onProgress = ({ loaded, total }) => hooks.onProgress?.(loaded, total);

    if (hooks.onPassword) {
      task.onPassword = (updatePassword, reason) => {
        hooks.onPassword(reason).then((pw) => {
          if (pw == null) task.destroy(new Error('password-cancelled'));
          else updatePassword(pw);
        });
      };
    }

    try {
      this.doc = await task.promise;
    } finally {
      if (this.doc == null && this.loadingTask === task) this.loadingTask = null;
    }
    return this.doc;
  }

  destroy() {
    this.#textCache.clear();
    try { this.loadingTask?.destroy(); } catch { /* already gone */ }
    this.loadingTask = null;
    this.doc = null;
  }

  get ready() { return !!this.doc; }
  get numPages() { return this.doc?.numPages ?? 0; }

  async metadata() {
    const md = await this.doc.getMetadata().catch(() => null);
    return {
      title: md?.info?.Title?.trim() || null,
      author: md?.info?.Author?.trim() || null,
    };
  }

  // ----------------------------------------------------------------- pages

  page(n) { return this.doc.getPage(n); }

  /** Page size in CSS pixels at scale 1, viewer rotation applied. */
  async pageSize(n) {
    const page = await this.page(n);
    const vp = page.getViewport({ scale: 1, rotation: (page.rotate + this.rotation) % 360 });
    return { width: vp.width, height: vp.height };
  }

  async viewport(n, scale) {
    const page = await this.page(n);
    return page.getViewport({
      scale,
      rotation: (page.rotate + this.rotation) % 360,
    });
  }

  /**
   * Render a page into a canvas at CSS `scale`, honoring device pixel ratio
   * while capping total pixels. Returns a handle with a cancelable promise.
   */
  startRender(n, canvas, scale) {
    let renderTask = null;
    let cancelled = false;

    const promise = (async () => {
      const viewport = await this.viewport(n, scale);
      if (cancelled) throw new RenderCancelled();

      const dpr = Math.min(devicePixelRatio || 1, 2.5);
      let outW = Math.floor(viewport.width * dpr);
      let outH = Math.floor(viewport.height * dpr);
      if (outW * outH > MAX_CANVAS_PIXELS) {
        const k = Math.sqrt(MAX_CANVAS_PIXELS / (outW * outH));
        outW = Math.floor(outW * k);
        outH = Math.floor(outH * k);
      }

      canvas.width = outW;
      canvas.height = outH;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext('2d', { alpha: false });
      renderTask = (await this.page(n)).render({
        canvasContext: ctx,
        viewport,
        intent: 'display',
      });

      try {
        await renderTask.promise;
      } catch (err) {
        canvas.width = 0;
        if (err?.name === 'RenderingCancelledException' || cancelled) {
          throw new RenderCancelled();
        }
        throw err;
      }
      return {
        cssWidth: Math.floor(viewport.width),
        cssHeight: Math.floor(viewport.height),
      };
    })();

    return {
      promise,
      cancel() {
        cancelled = true;
        try { renderTask?.cancel(); } catch { /* noop */ }
      },
    };
  }

  /** Render a small thumbnail of a page into its own canvas. */
  async renderThumb(n, canvas, cssWidth) {
    const size = await this.pageSize(n);
    const scale = cssWidth / size.width;
    const viewport = await this.viewport(n, scale);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    const ctx = canvas.getContext('2d', { alpha: false });
    await (await this.page(n)).render({
      canvasContext: ctx,
      viewport,
      intent: 'display',
    });
    return { w: canvas.width, h: canvas.height, cssW: viewport.width, cssH: viewport.height };
  }

  // ------------------------------------------------------------------ text

  /** Full text items for a page (search index). Cached per document. */
  async textItems(n) {
    if (this.#textCache.has(n)) return this.#textCache.get(n);
    const page = await this.page(n);
    const content = await page.getTextContent();
    this.#textCache.set(n, content.items);
    return content.items;
  }

  /** Streaming text source for a PDF.js TextLayer (selection). */
  async textLayerSource(n) {
    const page = await this.page(n);
    return page.streamTextContent();
  }

  // --------------------------------------------------------------- outline

  async outline() {
    const raw = await this.doc.getOutline().catch(() => null);
    if (!raw?.length) return [];

    const resolve = async (item) => ({
      title: item.title?.trim() || 'Untitled',
      page: await this.#destPage(item.dest),
      children: item.items?.length
        ? Promise.all(item.items.map(resolve))
        : [],
    });
    return Promise.all(raw.map(resolve));
  }

  async #destPage(dest) {
    try {
      const explicit = typeof dest === 'string'
        ? await this.doc.getDestination(dest)
        : dest;
      if (!Array.isArray(explicit) || !explicit[0]) return null;
      const index = await this.doc.getPageIndex(explicit[0]);
      return index + 1;
    } catch { return null; }
  }

  /** Jump target for a "page N" label inside an outline item. */
  clearTextCache() { this.#textCache.clear(); }
}
