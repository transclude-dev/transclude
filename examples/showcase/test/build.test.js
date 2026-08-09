import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderRoute, responseOf } from '@transclude/core/document';
import { cookiesOf } from '@transclude/core/cookies';

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
    {
      clientEntry: route.client,
      stylesheet,
      // The home page transcludes a section of MDN and a fragment of /notes.
      // These tests are about this app's own markup, so both are stubbed: the
      // first would need the network, and the second would need the route table
      // that only the running server has.
      include: {
        resolve: async () => '<h2 id="accessibility">Accessibility</h2>',
        route: async (path, id) => `<div id="${id}">from ${path}</div>`,
      },
    },
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
  // Virtual ids may survive in rollup's fragment comments; what matters is that
  // nothing still tries to *import* one, since nothing would resolve it.
  assert.doesNotMatch(entry, /from\s*['"]virtual:transclude-/, 'a virtual id is still imported');
  assert.doesNotMatch(entry, /from\s*['"]vite/, 'vite is still imported');
  assert.match(entry, /export\s*\{[^}]*pages/, 'exports the page map');
});

describe('the server bundle is not type checked by the app that imports it', () => {
  // `worker.js` imports this file, and `worker.js` is in the app's jsconfig, so
  // without the banner an editor reports twenty errors about generated code.
  assert.match(read('server/entry.js'), /^\/\/ @ts-nocheck\n/);
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

describe('the build writes the feed, and it is well-formed', () => {
  // The config, the mount and the build write are three separate places. Only
  // reading the built file proves all three agree.
  const xml = read(path.join('static', 'feed.xml'));

  assert.match(xml, /<rss version="2.0"/);
  assert.equal(xml.match(/<item>/g).length, 3, 'one item per person');
  // Newest first, so the most recently joined leads.
  assert.match(xml, /<item>\s*<title>Radia Perlman<\/title>/);
  // A description carrying real punctuation survives as text, not as entities.
  assert.match(xml, /<!\[CDATA\[Designed the spanning-tree protocol/);
});

describe('the home page carries the transcluded section, not the fallback', () => {
  // Resolved before the render, so it is in the HTML that arrives rather than
  // something the browser fetches later.
  assert.match(home, /<section class="borrowed">/);
  assert.doesNotMatch(home, /could not be read/, 'the fallback rendered instead');
  // The tag, not the word: "transclude" is the site's own name and appears all
  // over this page in prose.
  assert.doesNotMatch(home, /<transclude[\s>]/, 'the element was left in the output');
});

// ---- the sprite, for a runtime with no filesystem --------------------------

describe('every icon sheet is in the bundle, not only on disk', async () => {
  // The Node server reads `dist/public` off a disk and workerd cannot, so the
  // same bytes are emitted as a module it imports. Verified once by hand against
  // `wrangler dev`, and asserted here because CI runs no worker and a check
  // nothing runs is a check that rots.
  //
  // Every sheet, because a library is a directory the author made: the build
  // writes one file per library and missing the second one is the failure that
  // would look like a single icon set quietly losing half of itself.
  const { publicFiles } = await import(pathToFileURL(path.join(dist, 'server/assets.js')).href);

  for (const sheet of ['icons', 'glyphicons']) {
    const url = `/${sheet}.svg`;
    const entry = publicFiles[url];
    assert.ok(entry, `no ${url} in the asset module, so a worker would 404 it`);
    assert.match(entry.type, /^image\/svg\+xml/);

    // The same bytes both ways. Two copies of one file is how a worker comes to
    // serve last build's icons while Node serves this one's.
    const onDisk = fs.readFileSync(path.join(dist, `public/${sheet}.svg`), 'utf8');
    assert.equal(Buffer.from(entry.body, 'base64').toString('utf8'), onDisk);
  }
});

describe('one name in two libraries is two different icons', async () => {
  // What the flat reading refused. `check` is in both, and each sheet holds its
  // own drawing of it.
  const icons = fs.readFileSync(path.join(dist, 'public/icons.svg'), 'utf8');
  const glyphicons = fs.readFileSync(path.join(dist, 'public/glyphicons.svg'), 'utf8');

  assert.match(icons, /<symbol id="check"/);
  assert.match(glyphicons, /<symbol id="check"/);
  assert.notEqual(icons, glyphicons, 'the two sheets are the same bytes');
});

// ---- speculation --------------------------------------------------------------

describe('a page that runs a loader is never offered for prerender', () => {
  // The claim the feature rests on. `/notes` reads a cookie and `/` reads a
  // query string, so both are server-rendered: the browser may fetch them and
  // must not run them before the reader clicks.
  const rules = JSON.parse(manifest().speculate);
  const listed = (kind) =>
    (rules[kind] ?? []).flatMap((rule) => rule.where.or.map((clause) => clause.href_matches));

  const run = listed('prerender');
  const fetched = listed('prefetch');

  assert.ok(run.includes('/check'), '/check is a file and is not offered');
  for (const dynamic of ['/', '/notes']) {
    assert.ok(!run.includes(dynamic), `${dynamic} runs a loader and may be prerendered`);
    assert.ok(fetched.includes(dynamic), `${dynamic} is not even prefetched`);
  }

  // An endpoint answers with whatever it builds. Speculating one spends a
  // request nothing will reuse.
  for (const endpoint of ['/api/people', '/api/checks']) {
    assert.ok(![...run, ...fetched].includes(endpoint), `${endpoint} is speculated`);
  }
});

describe('every page carries the same rules, file or server-rendered', () => {
  // Two computations is two answers, and only one of them was checked.
  const inFile = read('static/check/index.html').match(
    /<script type="speculationrules">([\s\S]*?)<\/script>/,
  );
  assert.ok(inFile, 'the prerendered page has no rules block');
  assert.equal(inFile[1], manifest().speculate);
});

// ---- what the build must not publish ---------------------------------------

describe('an operating system leaving a file in public does not publish it', () => {
  // `/.DS_Store` answered 200 on the docs site and lists every file beside it.
  // Dotfiles are not skipped wholesale: `.well-known` is meant to be published.
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(entry.name);
    }
  };

  const out = path.join(dist, 'public');
  if (!fs.existsSync(out)) return;
  walk(out);

  for (const junk of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) {
    assert.ok(!files.includes(junk), `${junk} was copied into the build`);
  }
});

// ---- drafts ----------------------------------------------------------------
//
// `export const draft = true` is the one thing here that is in the source and
// deliberately not in the build. Every assertion below is about absence, which
// is why they are worth having: nothing about a missing page looks wrong from
// inside the repository.

test('a draft is in the source', () => {
  // If this file goes, the three tests under it pass by having nothing to find.
  const source = fs.readFileSync(path.join(root, 'app/routes/draft-example.html'), 'utf8');
  assert.match(source, /export const draft = true/);
});

test('a draft is not written to a file', () => {
  assert.equal(fs.existsSync(path.join(dist, 'static/draft-example/index.html')), false);
  assert.equal(fs.existsSync(path.join(dist, 'static/draft-example.html')), false);
});

test('a draft is not a route the server knows', () => {
  // Absent here is what makes the deployed URL a 404 rather than a page.
  const routes = fs.readFileSync(path.join(dist, 'routes.json'), 'utf8');
  assert.doesNotMatch(routes, /draft-example/);
});

test('a draft is not advertised in the sitemap', () => {
  // This app has no `sitemap` in its config, so there is nothing to read and
  // asserting against a file that was never written is a test that passes by
  // finding nothing. The sitemap takes the same route list the rest of the
  // build does, so a draft is out of it by construction; what is checked here
  // is that the file's absence is the reason, and not a silent read failure.
  const at = path.join(dist, 'static/sitemap.xml');
  if (!fs.existsSync(at)) {
    assert.doesNotMatch(fs.readFileSync(path.join(dist, 'routes.json'), 'utf8'), /draft-example/);
    return;
  }

  assert.doesNotMatch(fs.readFileSync(at, 'utf8'), /draft-example/);
});
