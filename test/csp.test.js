// A Content-Security-Policy built from what the document inlines.
//
// Hashes rather than nonces. A nonce is fresh per request, so a page carrying
// one cannot be a file, and every prerendered page here is a file written once
// and compressed once. A hash is fixed when the page is rendered, so it survives
// being written to disk and served by a host that knows nothing about this.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { CSP_DEFAULTS, inlineSources, policyFor, withPolicy } from '../src/csp.js';
import { htmlAttrsOf, renderRoute, responseOf } from '../src/document.js';

/** What the browser will compute, from a library that is not the one under test. */
const expected = (source) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`;

/** Both directives hashed, for the tests that are about the mechanism. */
const HASH_BOTH = { 'script-src': ["'self'", "'hashes'"], 'style-src': ["'self'", "'hashes'"] };

const doc = (head = '', body = '<p>x</p>') =>
  `<!doctype html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

// ---- what counts as inline ------------------------------------------------

test('an inline script and an inline style are both found', () => {
  const html = doc('<script>a()</script>\n<style>p{color:red}</style>');
  assert.deepEqual(inlineSources(html), [
    { kind: 'script', body: 'a()' },
    { kind: 'style', body: 'p{color:red}' },
  ]);
});

test('a script with a src runs a file, so it is not hashed', () => {
  // It is covered by `'self'`. Hashing it would hash an empty body and allow
  // every empty script on the page instead.
  const html = doc('<script type="module" src="/assets/x.js"></script>');
  assert.deepEqual(inlineSources(html), []);
});

test('a raw text element ends at its first closing tag, the way the parser does', () => {
  // Not an approximation. `</style>` inside a CSS string ends the element for
  // the browser too, so matching it here agrees with what will actually run.
  const html = doc('<style>p::after{content:"</style>"}</style>');
  assert.deepEqual(inlineSources(html), [{ kind: 'style', body: 'p::after{content:"' }]);
});

// ---- the digest -----------------------------------------------------------

test('a hash is a real SHA-256, checked against node:crypto', async () => {
  // The injected `hash` is an ETag and a test hands it a fake. This one has to
  // be the digest the browser computes or the script is refused.
  const policy = await policyFor(doc('<script>a()</script>'));
  assert.match(policy, new RegExp(escape(expected('a()'))));
});

test('script hashes and style hashes do not cross', async () => {
  const policy = await policyFor(doc('<script>a()</script>\n<style>b{}</style>'), { directives: HASH_BOTH });
  const [, scriptSrc] = policy.match(/script-src ([^;]+)/);
  const [, styleSrc] = policy.match(/style-src ([^;]+)/);

  assert.ok(scriptSrc.includes(expected('a()')));
  assert.ok(!scriptSrc.includes(expected('b{}')), 'a style hash reached script-src');
  assert.ok(styleSrc.includes(expected('b{}')));
});

test('two identical blocks contribute one hash', async () => {
  const policy = await policyFor(doc('<script>a()</script>\n<script>a()</script>'));
  const [, scriptSrc] = policy.match(/script-src ([^;]+)/);

  assert.equal(scriptSrc.split(expected('a()')).length - 1, 1);
});

// ---- the policy -----------------------------------------------------------

test('a document with nothing inline still gets the rest of the policy', async () => {
  const policy = await policyFor(doc());
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
});

test("a directive left with no sources is dropped, not emitted empty", async () => {
  // An empty source list means "allow nothing", which is `'none'`. Saying that
  // by accident would break the page rather than protect it.
  const policy = await policyFor(doc(), { directives: { 'script-src': ["'hashes'"] } });
  assert.equal(policy, '');
});

test("`'hashes'` is where a page's own digests go, and only there", async () => {
  const policy = await policyFor(doc('<script>a()</script>'), {
    directives: { 'script-src': ["'self'"], 'default-src': ["'none'"] },
  });

  assert.doesNotMatch(policy, /sha256/, 'a directive that did not ask for them got them');
});

// ---- inline style attributes ----------------------------------------------

test('the default policy does not block a style attribute', async () => {
  // The check that was missing. Hashing `<style>` blocks was verified and the
  // page still looked wrong, because `style="…"` on an element is a different
  // thing: a hash never covers an attribute. Every shiki token carries one, and
  // `style="view-transition-name: …"` is ordinary here.
  const policy = await policyFor(doc('<style>p{}</style>', '<span style="color:red">x</span>'));
  const [, styleSrc] = policy.match(/style-src ([^;]+)/);

  assert.ok(styleSrc.includes("'unsafe-inline'"), 'style attributes would be blocked');
  assert.ok(!styleSrc.includes('sha256'), "a hash makes 'unsafe-inline' ignored, allowing nothing");
});

test('script stays strict while style does not', async () => {
  const policy = await policyFor(doc('<script>a()</script>'));

  assert.match(policy, /script-src 'self' 'sha256-/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
});

test("style-src can still be hashed by hand, for a page with no style attributes", async () => {
  const policy = await policyFor(doc('<style>p{}</style>'), {
    directives: { 'style-src': ["'self'", "'hashes'"] },
  });

  assert.match(policy, /style-src 'self' 'sha256-/);
});

// ---- how it is delivered --------------------------------------------------

test('the policy rides in a meta tag, so a static host needs to know nothing', async () => {
  const html = await withPolicy(doc('<script>a()</script>'), true);
  assert.match(html, /<meta http-equiv="content-security-policy" content="[^"]+">/);
  assert.match(html, /<\/head>/);
});

test('the meta goes last, so every block above it is covered', async () => {
  const html = await withPolicy(doc('<script>a()</script>'), true);
  assert.ok(html.indexOf('<script>a()') < html.indexOf('<meta http-equiv'));
});

test('reportOnly sets the other header name', async () => {
  const html = await withPolicy(doc(), { reportOnly: true });
  assert.match(html, /content-security-policy-report-only/);
});

test('a directive a meta tag cannot carry is dropped', async () => {
  // `frame-ancestors` is ignored in a meta tag. Emitting it would read as
  // clickjacking protection that is not there.
  const html = await withPolicy(doc(), {
    directives: { ...CSP_DEFAULTS, 'frame-ancestors': ["'self'"] },
  });

  assert.doesNotMatch(html, /frame-ancestors/);
  assert.match(html, /default-src/);
});

test('off by default: no config, no meta', async () => {
  assert.equal(await withPolicy(doc(), undefined), doc());
  assert.equal(await withPolicy(doc(), false), doc());
});

// ---- through a real render ------------------------------------------------

const pageOf = (over = {}) => ({
  layouts: [],
  css: 'p { color: red }',
  headScript: '<script>queueMicrotask(() => {})</script>',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  regions: {},
  load: async () => ({}),
  render: () => ({ default: '<p>x</p>' }),
  ...over,
});

const ctxOf = () => ({
  url: 'http://x/',
  params: {},
  route: { id: 'index', pattern: '/', path: '/' },
  request: null,
  fragment: null,
  action: null,
  response: responseOf(),
  htmlAttrs: htmlAttrsOf(),
});

test('a rendered page covers its own head script and its own styles', async () => {
  const html = await renderRoute(pageOf(), ctxOf(), { csp: { directives: HASH_BOTH } });

  assert.match(html, new RegExp(escape(expected('queueMicrotask(() => {})'))));
  assert.match(html, new RegExp(escape(expected('\np { color: red }\n'))));
});

test('the hashes match the bytes that shipped, not what we meant to ship', async () => {
  // The one property worth having. Re-hash the document as delivered and check
  // every block in it is named by the policy. Both directives hashed, so this
  // covers styles as well as scripts.
  const html = await renderRoute(pageOf(), ctxOf(), { csp: { directives: HASH_BOTH } });
  // The http-equiv one. `<meta name="viewport">` comes first in the document and
  // has a `content` too, which is what a looser match picks up.
  const policy = html.match(/http-equiv="content-security-policy" content="([^"]+)"/)[1];

  for (const { body } of inlineSources(html)) {
    assert.ok(policy.includes(expected(body)), `unhashed block: ${JSON.stringify(body)}`);
  }
});

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- the half a meta tag cannot carry -------------------------------------

test('frame-ancestors rides in a header, since a meta tag ignores it', async () => {
  const { headerPolicy } = await import('../src/csp.js');
  const header = headerPolicy(true);

  assert.equal(header.name, 'Content-Security-Policy');
  assert.equal(header.value, "frame-ancestors 'self'");
});

test('the header names no hash, so it is the same for every page', async () => {
  // That is what makes it middleware rather than something read back out of a
  // body that has already been compressed.
  const { headerPolicy } = await import('../src/csp.js');
  assert.doesNotMatch(headerPolicy(true).value, /sha256/);
});

test('the two halves do not overlap', async () => {
  const { headerPolicy } = await import('../src/csp.js');
  const inMeta = await withPolicy(doc(), true);

  assert.doesNotMatch(inMeta, /frame-ancestors/);
  assert.match(headerPolicy(true).value, /frame-ancestors/);
});

test('no meta-only directive means no header at all', async () => {
  const { headerPolicy } = await import('../src/csp.js');
  assert.equal(headerPolicy({ directives: { 'default-src': ["'self'"] } }), null);
  assert.equal(headerPolicy(false), null);
});

test('reportOnly names the other header here too', async () => {
  const { headerPolicy } = await import('../src/csp.js');
  assert.equal(headerPolicy({ reportOnly: true }).name, 'Content-Security-Policy-Report-Only');
});
