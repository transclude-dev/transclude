// A Content-Security-Policy for the document, built from what the document
// actually inlines.
//
// Hashes rather than nonces, which is the opposite of what most frameworks do,
// and the right way round here. A nonce has to be fresh per request, so a page
// carrying one cannot be cached, and every prerendered page here is a file that
// is written once, compressed once, and sent as bytes. Swapping a nonce into the
// body on the way out would mean decompressing and recompressing every response.
//
// A hash needs none of that. The inline content is fixed when the page is
// rendered, so the policy is fixed too: computed once, written into the file,
// and correct forever after with no server involved. A static host serves it
// unchanged.

/**
 * What a page gets when the config says `true`.
 *
 * `script-src` is hashed and `style-src` is not, which looks inconsistent and is
 * the only combination that works. A hash never covers an attribute: `style="…"`
 * on an element is checked against `style-src`, and the spec says a hash there
 * applies to `<style>` blocks only. Worse, `'unsafe-inline'` is *ignored* in a
 * directive that carries any hash, so listing both allows nothing extra.
 *
 * So hashing styles means no element may carry a `style` attribute, and
 * `style="view-transition-name: …"` is an ordinary thing to write here. Script
 * is where the protection matters: CSS cannot run code, and `script-src` stays
 * strict. Put `'hashes'` in `style-src` yourself if your pages have no inline
 * style attributes at all.
 */
export const CSP_DEFAULTS = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'hashes'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  // Clickjacking. A meta tag cannot carry it, so it rides in the header the
  // server sets, which is the reason there is a header at all.
  'frame-ancestors': ["'self'"],
};

/**
 * `<script>` and `<style>` bodies in a document, in source order.
 *
 * Both are raw text elements: the browser ends them at the first closing tag
 * whatever the content, so matching that way is not an approximation of the
 * parser, it is the same rule. A `<script src>` runs a file rather than a body
 * and is covered by `'self'`, so it is skipped.
 *
 * @param {string} html the rendered document
 * @returns {{ scripts: string[], styles: string[] }} block bodies, in source order
 */
export function inlineSources(html) {
  const found = [];

  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\ssrc\s*=/.test(attrs)) found.push({ kind: 'script', body });
  }
  for (const [, , body] of html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)) {
    found.push({ kind: 'style', body });
  }

  return found;
}

/**
 * `'sha256-…'`, the form a policy takes.
 *
 * WebCrypto rather than the injected `hash`: that one is an ETag, documented as
 * a cache key and not a signature, and a test hands it a fake. This has to be a
 * real digest or the browser refuses the script. `crypto.subtle` and `btoa` are
 * globals on all four runtimes, so neither costs the core a `node:` import.
 */
async function sha256(source) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));

  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);

  return `'sha256-${btoa(binary)}'`;
}

/**
 * The policy for one document.
 *
 * `'hashes'` in a source list is where this page's own digests go, so an author
 * replacing the defaults decides which directives get them. Empty means the
 * literal is dropped rather than left in, because `script-src 'self' 'hashes'`
 * with nothing to substitute is a policy naming a source that does not exist.
 *
 * @param {string} html
 * @param {{ directives?: Record<string, string[]> }} [options]
 * @returns {Promise<string>} the policy, with every `'hashes'` replaced
 */
export async function policyFor(html, { directives = CSP_DEFAULTS } = {}) {
  const inline = inlineSources(html);

  const scripts = await Promise.all(
    inline.filter((one) => one.kind === 'script').map((one) => sha256(one.body)),
  );
  const styles = await Promise.all(
    inline.filter((one) => one.kind === 'style').map((one) => sha256(one.body)),
  );

  const parts = [];
  for (const [name, sources] of Object.entries(directives)) {
    const hashes = name === 'script-src' ? scripts : name === 'style-src' ? styles : [];
    const resolved = sources.flatMap((source) => (source === "'hashes'" ? hashes : [source]));

    // A directive left with nothing is dropped. An empty source list means
    // "allow nothing", which is `'none'`, and saying that by accident would
    // break the page rather than protect it.
    if (resolved.length) parts.push(`${name} ${[...new Set(resolved)].join(' ')}`);
  }

  return parts.join('; ');
}

/**
 * The policy as a `<meta>`, inserted just before `</head>`.
 *
 * A meta tag rather than a header, because a prerendered page is a file and
 * `dist/static` is meant to be servable by a host that knows nothing about this
 * framework. `frame-ancestors`, `report-uri`, `report-to` and `sandbox` cannot
 * be delivered this way and are dropped; set those as real headers at the host.
 */
const META_ONLY = new Set(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

/**
 * The directives a meta tag cannot carry, as a header.
 *
 * None of them names a hash, so this string is the same for every page: it can
 * be set once as middleware, ahead of any route, and it costs a prerendered page
 * nothing. That is why the split is worth having rather than reading the meta
 * back out of a body that is already compressed.
 *
 * `null` when there are none, which is the default. Adding a header nobody asked
 * for is a header to explain later.
 *
 * @param {object|boolean|null} config
 * @returns {string|null} the directives a meta tag cannot carry
 */
export function headerPolicy(config) {
  if (!config) return null;

  const options = config === true ? {} : config;
  const directives = options.directives ?? CSP_DEFAULTS;

  const parts = Object.entries(directives)
    .filter(([name]) => META_ONLY.has(name))
    .map(([name, sources]) => `${name} ${[...new Set(sources)].join(' ')}`);

  if (!parts.length) return null;

  return {
    name: options.reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy',
    value: parts.join('; '),
  };
}

/**
 * @param {string} html
 * @param {object|boolean|null} config
 * @returns {Promise<string>} the document with its meta tag, or unchanged when off
 */
export async function withPolicy(html, config) {
  if (!config) return html;

  const options = config === true ? {} : config;
  const directives = options.directives ?? CSP_DEFAULTS;

  const deliverable = Object.fromEntries(
    Object.entries(directives).filter(([name]) => !META_ONLY.has(name)),
  );

  const policy = await policyFor(html, { directives: deliverable });
  if (!policy) return html;

  const name = options.reportOnly
    ? 'content-security-policy-report-only'
    : 'content-security-policy';
  const meta = `<meta http-equiv="${name}" content="${policy.replace(/"/g, '&quot;')}">`;

  // One `</head>` in a document this built. Inserted last so a hash covers every
  // inline block above it, and the meta itself carries none to cover.
  return html.replace('</head>', `${meta}\n</head>`);
}
