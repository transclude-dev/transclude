// `<link rel="canonical">` on every page, from `canonical: true` in the config.
//
// The framework already holds every fact the tag needs: `metadataBase` is the
// origin and `route.path` is the page. Without this the app restates both in a
// layout, and `trailingSlash: 'ignore'` serves one page at two URLs with nothing
// saying which is the one.
//
// Off by default, because a page mounted at a second URL on purpose would get a
// tag naming the wrong one, and that is worse than no tag at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  absoluteFrom,
  renderDocument,
  renderFragment,
  renderRoute,
  responseOf,
} from '../src/document.js';
import { withDefaults } from '../src/defaults.js';

const pageOf = (over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  regions: {},
  load: async () => ({}),
  render: () => ({ default: '<p>x</p>' }),
  ...over,
});

/**
 * A ctx for one path, with the origin a request arrived on and the one the config
 * names kept apart, because telling them apart is most of what this feature does.
 */
const ctxOf = (path, { metadataBase, requestOrigin = 'http://localhost:1960' } = {}) => ({
  url: `${requestOrigin}${path}`,
  params: {},
  route: { id: 'page', pattern: path, path },
  request: null,
  fragment: null,
  action: null,
  response: responseOf(),
  absolute: absoluteFrom(metadataBase, `${requestOrigin}${path}`),
});

/** The `href` of the one canonical link, or null when the document has none. */
const canonicalOf = (html) => html.match(/<link rel="canonical" href="([^"]*)">/)?.[1] ?? null;

// ---- the config ------------------------------------------------------------

test('off unless the config asks', () => {
  assert.equal(withDefaults({}).canonical, false);
});

test('on with no metadataBase is refused, and named, rather than half working', async () => {
  // The refusal is in `withDefaults` and not in the render, because two of the
  // four things that render a page have a request to fall back to and two do not.
  // Left to the render, this would emit a localhost URL in dev and throw in the
  // build.
  assert.throws(
    () => withDefaults({ canonical: true }),
    (error) => /canonical/.test(error.message) && /metadataBase/.test(error.message),
  );
});

test('off with no metadataBase is an ordinary config', () => {
  assert.doesNotThrow(() => withDefaults({ canonical: false }));
  assert.doesNotThrow(() => withDefaults({}));
});

// ---- the tag ---------------------------------------------------------------

test('a page renders no canonical unless one is asked for', async () => {
  const html = await renderRoute(pageOf(), ctxOf('/about'), {});
  assert.equal(canonicalOf(html), null);
});

test('the tag names the page it is on, absolute', async () => {
  const ctx = ctxOf('/blog/post', { metadataBase: 'https://acme.com' });
  const html = await renderRoute(pageOf(), ctx, { canonical: true });
  assert.equal(canonicalOf(html), 'https://acme.com/blog/post');
});

test('metadataBase wins over the origin the request arrived on', async () => {
  // The whole reason the tag is built from the config: behind a proxy the request
  // arrives on an internal address, and a canonical URL naming that one tells a
  // crawler to index a host nobody can reach.
  const ctx = ctxOf('/post', {
    metadataBase: 'https://acme.com',
    requestOrigin: 'http://10.0.0.4:3000',
  });
  const html = await renderRoute(pageOf(), ctx, { canonical: true });
  assert.equal(canonicalOf(html), 'https://acme.com/post');
});

test('the site root is a URL like any other', async () => {
  const ctx = ctxOf('/', { metadataBase: 'https://acme.com' });
  const html = await renderRoute(pageOf(), ctx, { canonical: true });
  assert.equal(canonicalOf(html), 'https://acme.com/');
});

test('an & in the path is escaped, so the tag stays one tag', async () => {
  // `&` is legal in a path and the URL parser leaves it alone, so the escaping
  // has to happen here. Unescaped it is a character reference the parser tries to
  // resolve.
  const ctx = ctxOf('/a&b', { metadataBase: 'https://acme.com' });
  const html = await renderRoute(pageOf(), ctx, { canonical: true });
  assert.match(html, /href="https:\/\/acme\.com\/a&amp;b"/);
});

// ---- what a page can still say ---------------------------------------------

test("a page's own canonical replaces the framework's, rather than doubling it", () => {
  // The merge already treats canonical as the one unique link. This is the tag
  // going through that merge as the outermost level rather than beside it: two
  // canonicals leave a crawler taking the first, which would be this one.
  const page = pageOf({
    renderHead: () => '<link rel="canonical" href="https://acme.com/one-true">',
  });
  const html = renderDocument([page], [{}], { canonical: 'https://acme.com/other' });

  assert.equal(html.match(/rel="canonical"/g).length, 1);
  assert.equal(canonicalOf(html), 'https://acme.com/one-true');
});

test('a fragment carries no canonical, because it is not a document', async () => {
  // Structural today: a fragment never reaches `renderDocument`. Held here
  // because the tag would be swapped into a page that already has one, and two
  // leave a crawler taking the first.
  const page = pageOf({ regions: { list: () => '<ul id="list"></ul>' } });
  const html = await renderFragment(page, ctxOf('/notes', { metadataBase: 'https://acme.com' }), {
    region: 'list',
    canonical: true,
  });

  // Asserted first, so a fragment that failed to render cannot pass this by
  // having no tag in nothing.
  assert.equal(html, '<ul id="list"></ul>');
  assert.equal(canonicalOf(html), null);
});

// ---- through the real app --------------------------------------------------
//
// `trailingSlash: 'ignore'` is the setting that makes the tag worth having, and
// the setting most able to make it wrong: one page answers at two URLs, so the
// tag has to name one of them and not whichever was asked for.

const { createApp } = await import('../src/app.js');

const appWith = (config) =>
  createApp({
    config,
    manifest: {
      routes: [{ id: 'about', pattern: '/about', params: [], client: null }],
      dynamic: [],
      endpoints: [],
    },
    pages: { about: pageOf() },
    statics: { get: () => null },
    assets: { get: () => null },
    hash: (body) => `"${body.length.toString(36)}"`,
    compress: null,
  });

test('both URLs of a loosely routed page name the one without the slash', async () => {
  const app = appWith({
    csrf: false,
    trailingSlash: 'ignore',
    canonical: true,
    metadataBase: 'https://acme.com',
  });

  const plain = await app.request('http://x/about');
  const slashed = await app.request('http://x/about/');

  assert.equal(slashed.status, 200, 'the loose router did not answer the slashed URL');
  assert.equal(canonicalOf(await plain.text()), 'https://acme.com/about');
  // Hono's loose router strips the slash from `c.req.path` before anything reads
  // it, so the tag needs no rule of its own. Held here because a router change
  // would break it silently, and a canonical naming a URL that redirects is
  // worse than none.
  assert.equal(canonicalOf(await slashed.text()), 'https://acme.com/about');
});

test('createApp refuses canonical with no metadataBase, like every other entry', () => {
  assert.throws(() => appWith({ csrf: false, canonical: true }), /metadataBase/);
});

test('renderDocument takes the URL itself, so it needs no request', () => {
  // The split: this half knows markup, `renderRoute` knows the request. It is
  // also what lets the four callers that render a page each pass one flag.
  const page = pageOf();
  assert.equal(canonicalOf(renderDocument([page], [{}], {})), null);
  assert.equal(
    canonicalOf(renderDocument([page], [{}], { canonical: 'https://acme.com/x' })),
    'https://acme.com/x',
  );
});
