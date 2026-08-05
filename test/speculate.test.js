// What the browser is told it may fetch, and what it is never told it may run.
//
// The second half is the reason this is a framework feature rather than a
// snippet. A prerender executes the page, so a route whose loader reads a
// cookie, counts a view or hands out a token must not be in that list. The build
// is the only thing that knows which routes became files.

import test from 'node:test';
import assert from 'node:assert/strict';

import { hrefPattern, speculateSettings, speculationRules } from '../src/speculate.js';

const parse = (site, options) => JSON.parse(speculationRules(site, options) ?? 'null');

/** Every pattern named under one rule kind, flattened out of the `or`. */
const matched = (rules, kind) =>
  (rules?.[kind] ?? []).flatMap((rule) => rule.where.or.map((clause) => clause.href_matches));

test('a file may be prerendered, because no loader is left to run', () => {
  const rules = parse({ prerendered: ['/', '/about'], dynamic: [] });

  assert.deepEqual(matched(rules, 'prerender'), ['/', '/about']);
  assert.equal(rules.prefetch, undefined);
});

test('a server-rendered route is fetched and never run', () => {
  // The claim the whole feature rests on. `/notes` reads a cookie, and a
  // prerender of it would run that loader for a reader who never clicked.
  const rules = parse({ prerendered: ['/about'], dynamic: ['/notes'] });

  assert.deepEqual(matched(rules, 'prerender'), ['/about']);
  assert.deepEqual(matched(rules, 'prefetch'), ['/notes']);
  assert.ok(!matched(rules, 'prerender').includes('/notes'), '/notes may be run');
});

test('a route pattern becomes a pattern a URL can match', () => {
  assert.equal(hrefPattern('/people/:name'), '/people/*');
  assert.equal(hrefPattern('/docs/:path{.+}'), '/docs/*');
  assert.equal(hrefPattern('/notes/:id/edit'), '/notes/*/edit');
  assert.equal(hrefPattern('/'), '/');
});

test('the emitted rules carry no route-pattern spelling', () => {
  // Hono's `{.+}` means nothing to a URL pattern, and a rule nobody can match is
  // a prefetch that silently never happens.
  const rules = parse({ prerendered: [], dynamic: ['/docs/:path{.+}'] });

  assert.deepEqual(matched(rules, 'prefetch'), ['/docs/*']);
});

test('exclude drops a path from both lists', () => {
  const rules = parse(
    { prerendered: ['/', '/admin'], dynamic: ['/notes', '/logout'] },
    { exclude: ['/admin', '/logout'] },
  );

  assert.deepEqual(matched(rules, 'prerender'), ['/']);
  assert.deepEqual(matched(rules, 'prefetch'), ['/notes']);
});

test('exclude is matched against the emitted pattern, not the route', () => {
  const rules = parse({ prerendered: [], dynamic: ['/docs/:path{.+}'] }, { exclude: ['/docs/*'] });

  assert.equal(rules, null, 'the only route was excluded and something was still emitted');
});

test('eagerness is carried, and a typo is refused', () => {
  const rules = parse({ prerendered: ['/'] }, { eagerness: 'conservative' });
  assert.equal(rules.prerender[0].eagerness, 'conservative');

  assert.throws(
    () => speculationRules({ prerendered: ['/'] }, { eagerness: 'agressive' }),
    /eagerness/,
  );
});

test('moderate is the default, so nothing is speculated without intent', () => {
  // Immediate and eager act before the reader has done anything. Moderate waits
  // for a hover, which is as close to a click as a guess gets.
  const rules = parse({ prerendered: ['/'] });
  assert.equal(rules.prerender[0].eagerness, 'moderate');
});

test('two builds of one site produce the same bytes', () => {
  // The block is inline script, so its CSP hash changes whenever it does. Route
  // order following the filesystem would change the hash for no reason.
  const a = speculationRules({ prerendered: ['/b', '/a'], dynamic: ['/z', '/y'] });
  const b = speculationRules({ prerendered: ['/a', '/b'], dynamic: ['/y', '/z'] });

  assert.equal(a, b);
});

test('a site with nothing to speculate emits nothing', () => {
  assert.equal(speculationRules({ prerendered: [], dynamic: [] }), null);
  assert.equal(speculationRules({}), null);
});

test('off is the default, and true is the defaults', () => {
  assert.equal(speculateSettings(false), null);
  assert.equal(speculateSettings(undefined), null);
  assert.deepEqual(speculateSettings(true), {});
  assert.deepEqual(speculateSettings({ eagerness: 'eager' }), { eagerness: 'eager' });
});
