import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderRoute, responseOf } from 'transclude/document';
import { cookiesOf } from 'transclude/cookies';

// These assert on this app's built output, so they belong to the app rather
// than to the framework. test/ -> project root
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const built = fs.existsSync(path.join(dist, 'routes.json'));

// These assert on the output of `npm run build`, which is not run for us.
const describe = built ? test : test.skip;

const read = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8');
const manifest = () => JSON.parse(read('routes.json'));

/**
 * A page left to the server has no file to read, so the assertions about its
 * output render it the way the server does: same bundle, same entry point.
 * Nothing about the compiler's output differs between the two paths; what
 * differs is that this one can see the request.
 */
const pages = built
  ? (await import(pathToFileURL(path.join(dist, 'server/entry.js')).href)).pages
  : {};

const serverRender = (id, url) => {
  const { dynamic, stylesheet } = manifest();
  const route = dynamic.find((entry) => entry.id === id);
  // Prerendered instead: the assertions about compiler output hold either way,
  // so they should keep working and let the opt-out test be the one that fails.
  if (!route) return read(id === 'index' ? 'static/index.html' : `static/${id}/index.html`);

  return renderRoute(
    pages[id],
    {
      url: `http://localhost${url}`,
      params: {},
      route: { id, pattern: route.pattern, path: url },
      request: null,
      fragment: null,
      action: null,
      ...(() => {
        const response = responseOf();
        return { response, cookies: cookiesOf(null, response, 'a-secret-for-tests') };
      })(),
    },
    { clientEntry: route.client, stylesheet },
  );
};

const home = built ? await serverRender('index', '/') : '';

describe('static routes are prerendered to files a plain host can serve', () => {
  assert.ok(fs.existsSync(path.join(dist, 'static/check/index.html')));
  assert.ok(fs.existsSync(path.join(dist, 'static/404.html')));
});

describe('a dynamic route is prerendered once per entry its paths export names', () => {
  for (const slug of ['ada-lovelace', 'grace-hopper', 'radia-perlman']) {
    assert.ok(
      fs.existsSync(path.join(dist, `static/people/${slug}/index.html`)),
      `missing ${slug}`,
    );
  }
});

describe('a route with no paths export is left to the server', () => {
  const { dynamic } = manifest();
  assert.ok(dynamic.map((route) => route.pattern).includes('/docs/:path{.+}'));
});

describe('rendered HTML carries both renderings', () => {
  const html = home;

  // Elements that opted into a shadow root ship one, inline.
  assert.match(html, /<template shadowrootmode="open">/);
  assert.ok(html.split('shadowrootmode').length - 1 >= 2, 'nested roots survived');

  // Light ones are just markup, with their styles hoisted and scoped.
  assert.match(html, /@scope \(/);
  assert.match(html, /<data-table[^>]*>\s*<table/, 'a light element renders inline');
});

describe('layout chrome and layout data are baked in', () => {
  const detail = read('static/people/ada-lovelace/index.html');
  assert.match(detail, /<nav>/, 'root layout');
  assert.match(detail, /class="crumbs"/, 'nested layout');
  assert.match(detail, /Entry 1 of 3/, 'data that came from the layout above');
});

describe('the page title beats the layout title in built output', () => {
  assert.match(home, /<title>Single-file elements · transclude<\/title>/);
  assert.match(read('static/404.html'), /<title>Not found<\/title>/);
});

describe('escaping survives the build', () => {
  const html = home;
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

describe('client entries are hashed', () => {
  assert.match(home, /<script type="module" src="\/assets\/[^"]+-[A-Za-z0-9_-]{8}\.js">/);

  // /docs has no components and no client script of its own, and still gets one:
  // `fragmentParam` is set, so any page can be swapped into and needs the loader
  // that defines what arrives. Its entry is three imports and a call.
  const docs = manifest().dynamic.find((route) => route.id.startsWith('docs'));
  assert.ok(docs.client, 'a page that can receive a fragment ships no way to define it');
  assert.ok(
    fs.statSync(path.join(dist, 'client', docs.client)).size < 400,
    'the loader is supposed to be the smallest thing in the build',
  );
});

describe('the site stylesheet is one hashed, cacheable file', () => {
  const html = home;
  const links = html.match(/<link[^>]+stylesheet[^>]*>/g) ?? [];

  assert.equal(links.length, 1, 'exactly one, shared by every page');
  assert.match(links[0], /href="\/assets\/[^"]+-[A-Za-z0-9_-]{8}\.css"/);

  // Everything the compiler produces still travels inline: no second request.
  assert.match(html, /<style data-transclude-page>/);
});

describe('every page links the same stylesheet', () => {
  const hrefOf = (html) => /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1];
  const href = (file) => hrefOf(read(file));
  assert.equal(hrefOf(home), href('static/people/ada-lovelace/index.html'));
  assert.equal(hrefOf(home), href('static/404.html'));
});

describe('no dev-server plumbing leaks into built output', () => {
  const html = home;
  assert.doesNotMatch(html, /@vite\/client/);
  assert.doesNotMatch(html, /__x00__/);
  assert.doesNotMatch(html, /virtual:transclude-/);
});

describe('the server bundle runs without vite', () => {
  const entry = read('server/entry.js');
  // Virtual ids may survive in rollup's region comments; what matters is that
  // nothing still tries to *import* one, since nothing would resolve it.
  assert.doesNotMatch(entry, /from\s*['"]virtual:transclude-/, 'a virtual id is still imported');
  assert.doesNotMatch(entry, /from\s*['"]vite/, 'vite is still imported');
  assert.match(entry, /export\s*\{[^}]*pages/, 'exports the page map');
});

describe('a page opting out of prerendering is left to the server', () => {
  const patterns = manifest().dynamic.map((route) => route.pattern);

  // index.html exports `prerender = false` because it reads ?q, and one
  // prerendered file is one file for every URL that resolves to it.
  assert.ok(patterns.includes('/'), 'a static route with prerender=false must reach the server');
  assert.ok(!fs.existsSync(path.join(dist, 'static/index.html')), 'it was prerendered anyway');

  // The opt-out is per page, not a switch on the whole build.
  assert.ok(fs.existsSync(path.join(dist, 'static/check/index.html')), 'other pages still prerender');
});

describe('a server-rendered page can see the query string', async () => {
  assert.match(await serverRender('index', '/?q=hello'), /Searching for <code>hello<\/code>/);
  assert.doesNotMatch(home, /Searching for/, 'no query, no line');

  // The reason it has to be server-rendered at all: one file cannot do this.
  const other = await serverRender('index', '/?q=world');
  assert.match(other, /Searching for <code>world<\/code>/);
});

describe('a query value is escaped like any other interpolation', async () => {
  const html = await serverRender('index', '/?q=%3Cscript%3Ealert(1)%3C/script%3E');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<code><script>/);
});

// ---- post/redirect/get -----------------------------------------------------
//
// The bug this guards: a mutating action that answers with a rendered page
// instead of a redirect leaves the browser on a POST, so every reload submits
// the form again. It was reported by holding down refresh and watching the list
// grow, which no unit test was going to notice.

/** A loader's ctx, with the pieces it now reads. */
const loadCtx = (page, over = {}) => {
  const response = responseOf();
  return {
    url: `http://localhost/${page}`,
    params: {},
    route: { id: page, pattern: `/${page}`, path: `/${page}` },
    request: null,
    fragment: null,
    action: null,
    response,
    cookies: cookiesOf(null, response, 'a-secret-for-tests'),
    ...over,
  };
};

const postTo = (page, body, over = {}) => {
  const response = responseOf();
  return pages[page].POST({
    url: `http://localhost/${page}`,
    fragment: null,
    request: new Request(`http://localhost/${page}`, {
      method: 'POST',
      body: new URLSearchParams(body),
    }),
    response,
    cookies: cookiesOf(null, response, 'a-secret-for-tests'),
    ...over,
  });
};

describe('a mutation answers with a redirect, so a reload repeats a GET', async () => {
  const result = await postTo('notes', { text: 'from a test' });

  assert.ok(result instanceof Response, 'a rendered page here means reload re-submits');
  assert.equal(result.status, 303, '303 turns the POST into a GET; 302 may not');
  // A clean URL. The message used to ride here as `?added=…`, which meant any GET
  // of that URL claimed a note had been added. See the flash tests below.
  assert.match(result.headers.get('location') ?? '', /\/notes$/);
});

describe('a rejected submission does not redirect, because nothing changed', async () => {
  const before = (await pages.notes.load(loadCtx('notes'))).notes.length;
  const result = await postTo('notes', { text: '   ' });

  assert.ok(!(result instanceof Response), 'nothing was mutated, so there is nothing to redirect away from');
  assert.match(result.error, /needs some text/);

  const after = (await pages.notes.load(loadCtx('notes'))).notes.length;
  assert.equal(after, before);
});

describe('a fragment caller gets markup back, never a redirect', async () => {
  // A swap asked for HTML. A 303 would navigate the whole page instead.
  const result = await postTo('notes', { text: 'for a fragment' }, { fragment: 'list' });
  assert.ok(!(result instanceof Response));
});

// ---- the error page --------------------------------------------------------

describe('500.html is prerendered to a file, like the not-found page', () => {
  // It renders when something is already broken, so it must not need a loader, a
  // database, or a request. Anything that can also be broken.
  assert.ok(fs.existsSync(path.join(dist, 'static/500.html')));
  assert.match(read('static/500.html'), /<title>Something broke<\/title>/);
});

describe('the error page is in the manifest so the server can find it', () => {
  assert.equal(manifest().error?.id, '500');
});


// ---- a flash message is read once ------------------------------------------
//
// Reported: after a server restart and a reload, the page said "Added This is a
// test" for a note that was never added and did not exist. The message was in the
// URL, as `?added=x`, which can be replayed and shared and outlives the thing it
// describes.

describe('a successful mutation redirects to a clean URL', async () => {
  const out = await postTo('notes', { text: 'flash test' });

  assert.ok(out instanceof Response);
  assert.equal(new URL(out.headers.get('location')).search, '', 'the message is back in the URL');
});

describe('the message travels in a cookie that expires quickly', async () => {
  const response = responseOf();
  const cookies = cookiesOf(null, response, 'a-secret-for-tests');
  await postTo('notes', { text: 'flash cookie' }, { response, cookies });

  const flash = response.headers.getSetCookie().find((c) => c.startsWith('flash='));
  assert.ok(flash, 'nothing carries the message across the redirect');
  assert.match(flash, /Max-Age=10\b/, 'a long-lived flash is not a flash');
  assert.match(flash, /HttpOnly/);
});

describe('reading it clears it, so a reload does not repeat it', async () => {
  // Two loads with the same cookie jar: the first says it, the second does not.
  const carried = responseOf();
  await postTo('notes', { text: 'once only' }, {
    response: carried,
    cookies: cookiesOf(null, carried, 'a-secret-for-tests'),
  });
  const header = carried.headers.getSetCookie().find((c) => c.startsWith('flash=')).split(';')[0];
  const request = new Request('http://localhost/notes', { headers: { Cookie: header } });

  const first = responseOf();
  const shown = await pages.notes.load({
    ...loadCtx('notes'),
    request,
    response: first,
    cookies: cookiesOf(request, first, 'a-secret-for-tests'),
  });
  assert.equal(shown.added, 'once only');
  assert.ok(
    first.headers.getSetCookie().some((c) => /^flash=/.test(c) && /Max-Age=0/.test(c)),
    'it was not cleared, so the next load repeats it',
  );

  // The browser would have dropped the cookie by now; without it, nothing is said.
  const second = responseOf();
  const again = await pages.notes.load({
    ...loadCtx('notes'),
    response: second,
    cookies: cookiesOf(new Request('http://localhost/notes'), second, 'a-secret-for-tests'),
  });
  assert.equal(again.added, null);
});
