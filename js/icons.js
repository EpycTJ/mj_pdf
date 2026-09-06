/**
 * MJ PDF Viewer — icon system
 *
 * One coherent set of stroke icons drawn on a 24×24 grid (stroke 1.75,
 * round caps and joins, currentColor) so they inherit text color, stay
 * crisp at any size, and cost a few hundred bytes each. Icons are rendered
 * inline via `icon()` / `mountIcons()` instead of an icon font or per-use
 * HTTP requests.
 */

const S = 1.75; // default stroke width

/** name -> inner SVG markup (paths/lines/circles) */
const ICONS = {
  // navigation & chrome -------------------------------------------------
  'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  'panel-left': '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'home': '<path d="m3 10.5 9-7.5 9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  'more': '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  'external': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',

  // files & opening -----------------------------------------------------
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 9 5-5 5 5"/><path d="M12 4v12"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'trash': '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'sparkles': '<path d="M12 4.5 13.7 9l4.5 1.7-4.5 1.7L12 17l-1.7-4.6L5.8 10.7 10.3 9z" fill="currentColor" stroke="none"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" stroke="none"/>',
  'lock': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',

  // reading & view ------------------------------------------------------
  'search': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
  'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/><path d="M11 8v6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/>',
  'fit-width': '<path d="M4.5 6.5v11"/><path d="M19.5 6.5v11"/><path d="M8.5 12h7"/><path d="m10.2 9.3-2.5 2.7 2.5 2.7"/><path d="m13.8 9.3 2.5 2.7-2.5 2.7"/>',
  'fit-page': '<path d="M8 3.5H5.5A2 2 0 0 0 3.5 5.5V8"/><path d="M16 3.5h2.5a2 2 0 0 1 2 2V8"/><path d="M8 20.5H5.5a2 2 0 0 1-2-2V16"/><path d="M16 20.5h2.5a2 2 0 0 0 2-2V16"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  'rotate-cw': '<path d="M21 4.5v5h-5"/><path d="M20.5 9.5A9 9 0 1 0 21 12"/>',
  'sun': '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2"/><path d="M12 19.5v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2.5 12h2"/><path d="M19.5 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
  'moon': '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  'contrast': '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
  'expand': '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M9 12h6"/>',
  'shrink': '<path d="M3 8h3a2 2 0 0 0 2-2V3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M9 12h6"/>',
  'list': '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
  'grid': '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  'keyboard': '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M6 14h.01"/><path d="M18 14h.01"/><path d="M9 14h6"/>',
  'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'bookmark': '<path d="M19 21 12 16.5 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  'alert': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.5h.01"/>',
  'github': '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
};

/** Build an inline <svg> string for an icon name. */
export function icon(name, { size = 20, cls = '', stroke = S } = {}) {
  const body = ICONS[name] ?? ICONS['file'];
  return `<svg class="icon${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/**
 * Replace every `[data-icon="name"]` placeholder in the document with its
 * inline SVG. Runs once at boot; dynamic DOM built in JS uses `icon()`
 * directly.
 */
export function mountIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.innerHTML = icon(el.dataset.icon);
    el.removeAttribute('data-icon');
  }
}

export const hasIcon = (name) => name in ICONS;
