// The embed route, over real requests through the built app.
//
// These check the contract other people's pages depend on: the headers, and
// that the URL answers with something you can put on a page whatever happened
// to the record. Nothing about that is visible from a unit test of the library,
// because it is the route that sets it.
//
// `npm run build` first. Without `dist/` there is no app to ask.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

// ---- the network this app will see ----------------------------------------

const SCHEMA = {
  id: 'example.atlas.test.thing',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: { type: 'object', required: ['note'], properties: { note: { type: 'string', maxGraphemes: 40 } } },
    },
  },
};

const PDS = 'https://pds.example';

const answers = {
  'https://plc.directory/did:plc:ada': {
    alsoKnownAs: ['at://ada.example'],
    service: [{ type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
  },
  '_atproto.ada.example': 'did=did:plc:ada',
  '_lexicon.test.atlas.example': 'did=did:plc:ada',
};

/** Which record keys exist. Everything else is a record that is not there. */
const RECORDS = { abc: { note: 'A record with a schema of its own.' } };

globalThis.fetch = async (input) => {
  const url = new URL(String(input));

  if (url.host === 'cloudflare-dns.com') {
    const name = url.searchParams.get('name') ?? '';
    const value = answers[name];
    if (!value) return Response.json({ Status: 3 });
    return Response.json({ Status: 0, Answer: [{ type: 16, data: `"${value}"` }] });
  }

  if (url.pathname.endsWith('/xrpc/com.atproto.repo.getRecord')) {
    const collection = url.searchParams.get('collection');
    const rkey = url.searchParams.get('rkey') ?? '';

    if (collection === 'com.atproto.lexicon.schema') {
      if (rkey !== 'example.atlas.test.thing') return refused('RecordNotFound');
      return Response.json({ uri: `at://did:plc:ada/${collection}/${rkey}`, cid: 'bafylex', value: SCHEMA });
    }

    if (!RECORDS[rkey]) return refused('Could not locate record');
    return Response.json({
      uri: `at://did:plc:ada/${collection}/${rkey}`,
      cid: 'bafyrec',
      value: RECORDS[rkey],
    });
  }

  const known = answers[String(input)];
  if (known) return Response.json(known);

  return new Response('unstubbed', { status: 500 });
};

const refused = (message) => new Response(JSON.stringify({ error: 'RecordNotFound', message }), { status: 400 });

const { app } = built ? await import('@transclude/core/production') : { app: null };

const URI = 'did:plc:ada/example.atlas.test.thing/abc';
const get = (url) => app.request(`http://localhost${url}`);

// ---- the contract ---------------------------------------------------------

describe('an embed is readable from anywhere, and says so', async () => {
  const res = await get(`/embed/${URI}`);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

describe('it is cached hard, and served stale for a day while it refreshes', async () => {
  // An embed sends other people's readers at other people's servers. This
  // header is the whole of what protects them.
  const res = await get(`/embed/${URI}`);
  const cache = res.headers.get('cache-control') ?? '';

  assert.match(cache, /max-age=300/);
  assert.match(cache, /stale-while-revalidate=86400/);
});

describe('the fragment is the markup alone, with no document around it', async () => {
  const res = await get(`/embed/${URI}?fragment=record`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.match(body, /^<div id="record">/);
  // `<head[ >]`, not `<head`: the card's own `<header>` is part of the record.
  assert.doesNotMatch(body, /<html[ >]|<head[ >]|<body[ >]|wordmark/);
  // Cross-origin still, because this is the URL a browser actually asks for.
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

describe('the whole page carries no navigation', async () => {
  // An embed goes on somebody else's page. A navigation bar for this site would
  // be an advertisement stapled to their article.
  const body = await get(`/embed/${URI}`).then((res) => res.text());

  assert.doesNotMatch(body, /class="wordmark"/);
  assert.doesNotMatch(body, /<trace-rail/);
});

describe('the record renders from its lexicon, the same as the page it came from', async () => {
  const body = await get(`/embed/${URI}?fragment=record`).then((res) => res.text());

  assert.match(body, /A record with a schema of its own\./);
  // `maxGraphemes` in the schema is what makes this prose rather than text, so
  // finding the meter proves the lexicon was read and not skipped.
  assert.match(body, /class="meter"/);
});

// ---- when the record is not there -----------------------------------------

describe('a record that is gone is a tombstone, and still a 200', async () => {
  // The contract is that this URL always answers with something you can put on
  // a page. A 404 would make `<transclude>` fall through to whatever the author
  // wrote, and their reader would never learn a record had been there.
  const res = await get('/embed/did:plc:ada/example.atlas.test.thing/deleted');
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.match(body, /This record is not available/);
  assert.match(body, /at:\/\/did:plc:ada\/example\.atlas\.test\.thing\/deleted/);
});

describe('a tombstone is cached and cross-origin like any other answer', async () => {
  const res = await get('/embed/did:plc:ada/example.atlas.test.thing/deleted');

  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('cache-control') ?? '', /max-age=300/);
});

describe('an identity that resolves nowhere is a tombstone too', async () => {
  const res = await get('/embed/did:plc:nobody/example.atlas.test.thing/abc');

  assert.equal(res.status, 200);
  assert.match(await res.text(), /This record is not available/);
});

describe('an embed names one record, not a collection', async () => {
  // `/embed/<did>/<collection>` would be a listing, and a listing is not a
  // thing to drop into somebody's article by accident.
  const res = await get('/embed/did:plc:ada/example.atlas.test.thing');

  assert.equal(res.status, 200);
  assert.match(await res.text(), /An embed names one record/);
});
