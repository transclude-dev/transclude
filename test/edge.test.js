// `edgeHeaders`: the `_headers` file for the files Cloudflare serves before
// a worker runs. Those files never pass through `baseApp`, so whatever it adds
// to every response has to be written here instead, or it is missing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { IMMUTABLE, MAX_LINE, edgeHeaders } from '../src/edge.js';
import { headerPolicy } from '../src/csp.js';
import { permissionsHeader } from '../src/permissions.js';
import { createApp } from '../src/app.js';

test('every file gets nosniff, and a hashed asset the long cache', () => {
  assert.equal(
    edgeHeaders({}),
    ['/*', '  X-Content-Type-Options: nosniff', '', '/assets/*', `  Cache-Control: ${IMMUTABLE}`, ''].join('\n'),
  );
});

test('the CSP and the permissions policy go on every file, as baseApp sends them', () => {
  const written = edgeHeaders({ csp: true, permissionsPolicy: true });
  const csp = headerPolicy(true);
  const permissions = permissionsHeader(true);
  assert.ok(csp && permissions);

  assert.ok(written.includes(`\n  ${csp.name}: ${csp.value}\n`), 'the CSP header is missing');
  assert.ok(written.includes(`\n  ${permissions.name}: ${permissions.value}\n`), 'the permissions header is missing');
});

test('a report-only CSP keeps its own header name', () => {
  assert.match(edgeHeaders({ csp: { reportOnly: true } }), /Content-Security-Policy-Report-Only: /);
});

test("the app's own _headers comes after the framework's", () => {
  const own = '/feed.xml\n  Content-Type: application/rss+xml\n';
  const written = edgeHeaders({}, own);

  assert.ok(written.startsWith('/*\n'));
  assert.ok(written.endsWith(own));
});

test('a header the platform would drop is refused', () => {
  // Cloudflare drops a long line and says nothing, so the site would go out
  // without its CSP and look the same.
  const long = { csp: { directives: { 'frame-ancestors': ['https://' + 'a'.repeat(MAX_LINE)] } } };
  assert.throws(() => edgeHeaders(long), /Content-Security-Policy header is \d+ characters/);
});

test('the long cache is the one the app sends for a hashed asset', async () => {
  // Two copies of one policy, because `app.js` exports only `createApp`. This
  // asks the app and compares, so they cannot drift apart.
  const entry = { body: new Uint8Array([1]), type: 'text/javascript', etag: '"a"', encodings: new Map() };
  const app = createApp({
    config: { csrf: false },
    manifest: { routes: [] },
    pages: {},
    assets: { get: () => entry },
    hash: async () => '"h"',
  });

  const response = await app.fetch(new Request('http://x/assets/entry-abc.js'));
  assert.equal(response.headers.get('Cache-Control'), IMMUTABLE);
});
