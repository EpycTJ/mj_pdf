/**
 * Loader hooks for the jsdom app test.
 *
 *  • maps the vendored (browser-only) modern PDF.js build to the equivalent
 *    legacy build, which loads under Node — the app code under test is
 *    identical, only the engine shim differs
 *  • maps js/engine.js to an in-memory mock so no real canvas is needed
 */

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const hooks = {
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
    if (url.endsWith('/js/engine.js')) {
      return {
        url: pathToFileURL(new URL('./engine.mock.mjs', import.meta.url).pathname).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
};

registerHooks(hooks);
