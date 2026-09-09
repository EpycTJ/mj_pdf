/**
 * Loader hook for engine.test.mjs — maps ONLY the vendored modern PDF.js
 * build to the Node-compatible legacy build. js/engine.js itself runs real.
 */

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = specifier.startsWith('.')
      ? new URL(specifier, context.parentURL).href
      : specifier;

    if (url.endsWith('/vendor/pdfjs/pdf.min.mjs')) {
      return {
        url: pathToFileURL(new URL('./vendor/pdf.legacy.mjs', import.meta.url).pathname).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
