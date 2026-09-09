/**
 * MJ PDF Viewer — shared utilities
 * Small, dependency-free helpers: DOM, formatting, timing, popovers, toasts.
 */

import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';

export const reducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Create an element with attributes and children in one call. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [children].flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

/** Trailing-edge debounce. */
export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** Coalesce frequent events into animation frames. */
export function raf(fn) {
  let queued = false;
  return (...args) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...args); });
  };
}

/** Wait for a transition/animation-friendly pause, then run. */
export const idle = (fn) =>
  ('requestIdleCallback' in window)
    ? requestIdleCallback(fn, { timeout: 200 })
    : setTimeout(fn, 0);

// ---------------------------------------------------------------- formatting

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let u = -1;
  do { n /= 1024; u++; } while (n >= 1024 && u < units.length - 1);
  return `${n >= 100 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '')} ${units[u]}`;
}

export function fmtAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ------------------------------------------------------------------- toasts

const TOAST_ICONS = { ok: 'check', error: 'alert', info: 'info' };

export function toast(message, { kind = 'info', timeout = 3400 } = {}) {
  const host = $('#toasts');
  if (!host) return;
  const node = el('div', { class: `toast toast-${kind}`, role: 'status' }, [
    el('span', { class: 'toast-icon', html: icon(TOAST_ICONS[kind] ?? 'info', { size: 16 }) }),
    el('span', { class: 'toast-msg' }, message),
  ]);
  host.append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  const dismiss = () => {
    node.classList.remove('is-in');
    setTimeout(() => node.remove(), reducedMotion() ? 0 : 220);
  };
  setTimeout(dismiss, timeout);
  node.addEventListener('click', dismiss);
}

// ----------------------------------------------------------------- popovers

/**
 * Lightweight popover controller: builds a floating panel next to an anchor,
 * closes on outside click / Escape / scroll, manages aria-expanded.
 */
export class Popover {
  /** @type {HTMLDivElement | null} */ panel = null;
  #outside = null;
  #onKey = null;

  constructor(anchor, build, { align = 'end', gap = 8, cls = '' } = {}) {
    this.anchor = anchor;
    this.build = build;
    this.align = align;
    this.gap = gap;
    this.cls = cls;
    this.#bind();
  }

  #bind() {
    this.anchor.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isOpen ? this.close() : this.open();
    });
  }

  get isOpen() { return !!this.panel; }

  open() {
    if (this.panel) return;
    const panel = el('div', {
      class: `popover ${this.cls}`.trim(),
      role: 'menu',
    });
    this.build(panel, this);
    document.body.append(panel);

    const r = this.anchor.getBoundingClientRect();
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    let left = this.align === 'end' ? r.right - pw : r.left;
    left = clamp(left, 8, innerWidth - pw - 8);
    let top = r.bottom + this.gap;
    if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - this.gap);
    Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });

    this.panel = panel;
    this.anchor.setAttribute('aria-expanded', 'true');
    panel.classList.add('is-in');

    this.#outside = (e) => {
      if (!panel.contains(e.target) && e.target !== this.anchor) this.close();
    };
    this.#onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
    document.addEventListener('pointerdown', this.#outside, true);
    document.addEventListener('keydown', this.#onKey, true);
    addEventListener('resize', () => this.close(), { once: true });
    // focus first focusable item for keyboard users
    panel.querySelector('button, [tabindex]')?.focus({ preventScroll: true });
  }

  close() {
    if (!this.panel) return;
    const panel = this.panel;
    this.panel = null;
    this.anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.#outside, true);
    document.removeEventListener('keydown', this.#onKey, true);
    panel.classList.remove('is-in');
    setTimeout(() => panel.remove(), reducedMotion() ? 0 : 140);
    this.anchor.focus({ preventScroll: true });
  }

  /** Re-render panel content while open (e.g. checked state changed). */
  refresh() { if (this.panel) { this.close(); this.open(); } }
}

/** A single row inside a popover menu. */
export function menuItem({ icon: ic, label, hint, checked, onClick, danger }) {
  const node = el('button', {
    class: `menu-item${danger ? ' menu-item-danger' : ''}`,
    role: 'menuitem',
    html: `${ic ? `<span class="menu-ic">${ic}</span>` : '<span class="menu-ic"></span>'}
           <span class="menu-label">${label}</span>
           ${hint ? `<span class="menu-hint">${hint}</span>` : ''}
           ${checked ? '<span class="menu-check"></span>' : ''}`,
  });
  if (onClick) node.addEventListener('click', (e) => { e.stopPropagation(); onClick(e, node); });
  return node;
}

// ------------------------------------------------------------------ dialogs

/** Promise-based <dialog> helper. */
export function openDialog(dialog) {
  return new Promise((resolve) => {
    const done = (value) => {
      dialog.close();
      resolve(value);
    };
    dialog.addEventListener('close', () => resolve(null), { once: true });
    dialog.returnValue = null;
    dialog.showModal();
    dialog._done = done; // dialogs wire their buttons to this
  });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
