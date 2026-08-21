// Fetching a foreign document, and answering with one fragment of it.
//
// The fragment is resolved here rather than in the browser. That keeps the
// untrusted markup on this side, keeps sanitizing somewhere it cannot be turned
// off, and means the page receives the piece it asked for instead of a whole
// document to sift through.
//
// Nothing here imports `node:`. Resolving a hostname to an address is the one
// check that needs the runtime, so it arrives as a function. See `lookup` below.

import { checkUrl } from './address.js';
import { indexDocument, resolveFragment } from './extract.js';
import { absolutize, baseOf, sanitize } from './rewrite.js';
import { parse } from 'parse5';

export const PROXY_PATH = '/_transclude/proxy';

const DEFAULTS = {
  allow: [],
  maxBytes: 5 * 1024 * 1024,
  timeout: 10_000,
  redirects: 5,
  sanitize: true,
  // What to do with a `style` attribute the source wrote. `<style>` blocks and
  // `<link>` are removed either way, because their rules reach the whole page.
  styles: 'keep',
  cache: 50,
  // How long a held document is used without asking the source anything. Ten
  // fragments off one page during a render should be one request, not ten
  // conditional ones.
  maxAge: 60_000,
};

const STYLE_MODES = new Set(['keep', 'strip']);

/**
 * Defaults filled in, and the one value worth checking checked. A misspelled
 * `styles` would keep every style attribute and say nothing, which reads exactly
 * like the setting working.
 */
function settings(options) {
  const config = { ...DEFAULTS, ...options };
  if (!STYLE_MODES.has(config.styles)) {
    throw new Error(
      `[transclude] proxy.styles is ${JSON.stringify(config.styles)}. It is 'keep' or 'strip'.`,
    );
  }
  return config;
}

/** A refusal that is safe to show, since it repeats only what was asked for. */
class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const HTML = /^(text\/html|application\/xhtml\+xml)/i;

/**
 * Follow redirects ourselves so every hop is checked.
 *
 * `redirect: 'follow'` would let the first response send us anywhere, and the
 * check that ran on the URL somebody typed says nothing about where hop three
 * landed. This is the whole reason the fetch is written out by hand.
 */
async function fetchChecked(url, config, deps) {
  const { fetch: get = globalThis.fetch, lookup = null } = deps;
  let at = url;

  for (let hop = 0; hop <= config.redirects; hop += 1) {
    const why = checkUrl(at, config);
    if (why) throw new Refused(403, why);

    if (lookup) {
      const blocked = await lookup(new URL(at).hostname);
      if (blocked) throw new Refused(403, `${new URL(at).hostname} resolves to ${blocked}`);
    }

    const response = await get(at, {
      redirect: 'manual',
      signal: AbortSignal.timeout(config.timeout),
      headers: { accept: 'text/html' },
    });

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      at = new URL(response.headers.get('location'), at).href;
      continue;
    }
    return { response, url: at };
  }

  throw new Refused(502, `more than ${config.redirects} redirects`);
}

/**
 * The body, refused past the cap.
 *
 * `content-length` is a claim, not a promise, so it is used to refuse early and
 * the bytes are counted anyway.
 */
async function bodyWithin(response, maxBytes) {
  const claimed = Number(response.headers.get('content-length'));
  if (claimed && claimed > maxBytes) throw new Refused(413, `document is larger than ${maxBytes} bytes`);

  if (!response.body) return await response.text();

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Refused(413, `document is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Parsed documents, by the URL they finally came from.
 *
 * Several fragments usually come from one page, so the parse, the cleaning and
 * the slug table are done once and shared. Keyed by the final URL rather than
 * the requested one, so two requests that redirect to the same place hit.
 *
 * @param {number} [max] how many documents to hold
 * @returns {{ get: Function, set: Function, size: () => number }}
 */
export function documentStore(max = DEFAULTS.cache) {
  const held = new Map();

  return {
    get(key) {
      const entry = held.get(key);
      if (!entry) return null;
      // Least recently used goes first, so re-insert on a hit.
      held.delete(key);
      held.set(key, entry);
      return entry;
    },
    set(key, entry) {
      held.delete(key);
      held.set(key, entry);
      while (held.size > max) held.delete(held.keys().next().value);
    },
    get size() {
      return held.size;
    },
  };
}

/** The entries with a value, so an empty one is left out rather than sent blank. */
function present(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value));
}

/**
 * A foreign document, fetched, cleaned and indexed.
 *
 * The order is deliberate: read the base before `<base>` is stripped, strip
 * before rewriting so nothing rewrites a URL on an element about to be removed,
 * and index last so the table never names something the cleaning took out.
 *
 * @param {string} url
 * @param {object} [options] the `proxy` config
 * @param {{ fetch?: Function, store?: object, now?: Function, lookup?: Function }} [deps]
 * @returns {Promise<object>} the indexed document, its base, and what was removed
 */
export async function readForeign(url, options = {}, deps = {}) {
  const config = settings(options);
  const store = deps.store ?? null;
  const now = deps.now ?? (() => Date.now());

  const held = store?.get(url) ?? null;
  if (held && now() - held.at < config.maxAge) return held;

  // A held copy with no ETag and no Last-Modified gives nothing to revalidate
  // against, and sending the headers empty would ask the origin to compare
  // against nothing. `present` drops them.
  const revalidate = held
    ? { 'if-none-match': held.etag ?? '', 'if-modified-since': held.lastModified ?? '' }
    : {};

  const get = deps.fetch ?? globalThis.fetch;
  const wrapped = held
    ? (at, init) =>
        get(at, {
          ...init,
          headers: { ...init.headers, ...present(revalidate) },
        })
    : get;

  const { response, url: final } = await fetchChecked(url, config, { ...deps, fetch: wrapped });

  if (response.status === 304 && held) {
    // Still current, so the parse stands and only its age moves.
    const refreshed = { ...held, at: now() };
    store?.set(url, refreshed);
    return refreshed;
  }
  if (!response.ok) throw new Refused(502, `the source answered ${response.status}`);

  const type = response.headers.get('content-type') ?? '';
  if (!HTML.test(type)) throw new Refused(415, `the source sent ${type || 'no content type'}`);

  const html = await bodyWithin(response, config.maxBytes);
  const base = baseOf(html, final);

  const root = parse(html);
  const removed = config.sanitize ? sanitize(root, { styles: config.styles }) : [];
  absolutize(root, base);

  const entry = {
    doc: indexDocument(root),
    base,
    removed,
    at: now(),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };

  store?.set(final, entry);
  // The requested URL is what the next request will arrive with, so it is held
  // too when a redirect moved us.
  if (final !== url) store?.set(url, entry);
  return entry;
}

/**
 * `GET /_transclude/proxy?url=…&id=…`
 *
 * Answers with the fragment, as markup. A page fetches this from its own origin,
 * which is also what makes it work at all: a cross-origin fetch is refused by
 * the default policy, which names `'self'` and nothing else.
 */
/**
 * A resolver for `renderRoute`: the markup of one fragment of one URL.
 *
 * Shares a store with nothing else on purpose. Includes are resolved during a
 * render, and holding the parsed document is what makes ten of them off one page
 * cost one read.
 *
 * @param {object} [options]
 * @param {object} [deps]
 * @returns {{ resolve: (url: string, id: string) => Promise<string> }}
 */
export function includeResolver(options = {}, deps = {}) {
  const config = settings(options);
  const store = deps.store ?? documentStore(config.cache);

  return {
    resolve: async (url, id) => {
      const entry = await readForeign(url, config, { ...deps, store });
      return resolveFragment(entry.doc, id)?.html ?? null;
    },
  };
}

/**
 * @param {object} [options]
 * @param {object} [deps]
 * @returns {(request: Request) => Promise<Response>}
 */
export function proxyHandler(options = {}, deps = {}) {
  const config = settings(options);
  const store = deps.store ?? documentStore(config.cache);

  return async (request) => {
    const asked = new URL(request.url);
    const url = asked.searchParams.get('url');
    const id = asked.searchParams.get('id');

    if (!url) return text(400, 'no url');

    try {
      const entry = await readForeign(url, config, { ...deps, store });

      // No id is a question about the document rather than a piece of it, so
      // the answer also says what the cleaning took out. The list was already
      // kept for exactly this; nothing read it until here.
      if (!id) {
        const { listFragments } = await import('./extract.js');
        return json(200, { url, fragments: listFragments(entry.doc), removed: entry.removed });
      }

      const found = resolveFragment(entry.doc, id);
      if (!found) return text(404, `no fragment "${id}" at ${url}`);

      return new Response(found.html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // The answer depends entirely on the query, and the source may change
          // under us, so nothing downstream should hold it on its own terms.
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      if (error instanceof Refused) return text(error.status, error.message);
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return text(504, 'the source did not answer in time');
      }
      return text(502, 'the source could not be read');
    }
  };
}

const text = (status, body) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
