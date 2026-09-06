/**
 * Test double for js/engine.js.
 *
 * Backed by the REAL PDF.js legacy build for page geometry, text and
 * outline (so the app logic is exercised against genuine data), but
 * canvas rendering is faked: startRender just sizes the canvas and
 * resolves, which is all the reader needs from a completed render.
 */

import * as pdfjs from './vendor/pdf.legacy.mjs';

export class RenderCancelled extends Error {
  constructor() { super('render cancelled'); this.name = 'RenderCancelled'; }
}

export class Engine {
  constructor() {
    this.doc = null;
    this.loadingTask = null;
    this.rotation = 0;
    this.openDelay = 0;
  }

  async open(source, hooks = {}) {
    this.doc = await pdfjs.getDocument({
      data: new Uint8Array(source.data),
      isEvalSupported: false,
      standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
      cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
      cMapPacked: true,
    }).promise;
    this.#textCache = new Map();
    return this.doc;
  }

  destroy() {
    this.#textCache?.clear();
    try { this.doc?.destroy(); } catch { /* noop */ }
    this.doc = null;
  }

  get ready() { return !!this.doc; }
  get numPages() { return this.doc?.numPages ?? 0; }

  async metadata() {
    const md = await this.doc.getMetadata().catch(() => null);
    return { title: md?.info?.Title?.trim() || null, author: md?.info?.Author || null };
  }

  page(n) { return this.doc.getPage(n); }

  async pageSize(n) {
    const page = await this.page(n);
    const vp = page.getViewport({ scale: 1, rotation: (page.rotate + this.rotation) % 360 });
    return { width: vp.width, height: vp.height };
  }

  async viewport(n, scale) {
    const page = await this.page(n);
    return page.getViewport({ scale, rotation: (page.rotate + this.rotation) % 360 });
  }

  startRender(n, canvas, scale) {
    const w = Math.round(595.28 * scale);
    const h = Math.round(841.89 * scale);
    const t = setTimeout(() => {
      canvas.width = w; canvas.height = h;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      done();
    }, 4);
    let settled = false;
    const done = () => { if (!settled) { settled = true; clearInterval(t); } };
    return {
      promise: new Promise((resolve, reject) => {
        this._reject = reject;
        setTimeout(() => { done(); resolve({ cssWidth: w, cssHeight: h }); }, 5);
      }),
      cancel() { done(); },
    };
  }

  async renderThumb(n, canvas, cssWidth) {
    const size = await this.pageSize(n);
    const k = cssWidth / size.width;
    canvas.width = Math.round(size.width * k);
    canvas.height = Math.round(size.height * k);
    return { w: canvas.width, h: canvas.height };
  }

  async textItems(n) {
    if (this.#textCache.has(n)) return this.#textCache.get(n);
    const page = await this.page(n);
    const content = await page.getTextContent();
    this.#textCache.set(n, content.items);
    return content.items;
  }

  async textLayerSource(n) {
    const page = await this.page(n);
    return page.streamTextContent();
  }

  async outline() {
    const raw = await this.doc.getOutline().catch(() => null);
    if (!raw?.length) return [];
    const resolve = async (item) => ({
      title: item.title?.trim() || 'Untitled',
      page: await this.#destPage(item.dest),
      children: item.items?.length ? Promise.all(item.items.map(resolve)) : [],
    });
    return Promise.all(raw.map(resolve));
  }

  async #destPage(dest) {
    try {
      const explicit = typeof dest === 'string' ? await this.doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || !explicit[0]) return null;
      return (await this.doc.getPageIndex(explicit[0])) + 1;
    } catch { return null; }
  }

  #textCache = new Map();
}
