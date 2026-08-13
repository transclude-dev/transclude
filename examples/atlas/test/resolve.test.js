// Fetching only the schemas a record actually reaches.
//
// The number this exists to hold down is a hard one. Cloudflare's free plan
// allows fifty subrequests per request, and the first version of this app asked
// for every schema a lexicon declares: `app.bsky.feed.post` declares nine, an
// ordinary post reaches one, and a lexicon page measured thirty-nine. These
// tests count requests, because a page that renders correctly and asks for
// twenty-seven things it does not use still fails once somebody publishes a
// slightly larger schema.

import test from 'node:test';
import assert from 'node:assert/strict';

import { clearCache } from '../app/lib/cache.js';
import { fieldsFor } from '../app/lib/resolve.js';
import { createTrace } from '../app/lib/trace.js';

// ---- a lexicon that declares more than any one record uses ----------------

const POST = {
  nsid: 'example.atlas.post',
  schema: {
    id: 'example.atlas.post',
    defs: {
      main: {
        type: 'record',
        record: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            reply: { type: 'ref', ref: '#replyRef' },
            embed: { type: 'union', refs: ['example.atlas.image', 'example.atlas.video'] },
            labels: { type: 'ref', ref: 'example.atlas.label' },
          },
        },
      },
      replyRef: { type: 'object', properties: { root: { type: 'ref', ref: 'example.atlas.strongref' } } },
    },
  },
};

/** A referenced document with a local ref of its own. */
const IMAGE = {
  nsid: 'example.atlas.image',
  schema: {
    id: 'example.atlas.image',
    defs: {
      main: { type: 'object', properties: { images: { type: 'array', items: { type: 'ref', ref: '#item' } } } },
      // `#item` is local to THIS document, not to the record's lexicon.
      item: { type: 'object', properties: { alt: { type: 'string', maxGraphemes: 100 } } },
    },
  },
};

const STRONGREF = {
  nsid: 'example.atlas.strongref',
  schema: {
    id: 'example.atlas.strongref',
    defs: { main: { type: 'object', properties: { uri: { type: 'string', format: 'at-uri' } } } },
  },
};

const PUBLISHED = { 'example.atlas.image': IMAGE, 'example.atlas.strongref': STRONGREF };

// ---- the network ----------------------------------------------------------

/** @type {string[]} */
let asked = [];

const install = () => {
  asked = [];
  clearCache();

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.host === 'cloudflare-dns.com') {
      asked.push(`dns:${url.searchParams.get('name')}`);
      return Response.json({ Status: 0, Answer: [{ type: 16, data: '"did=did:plc:pub"' }] });
    }

    if (url.pathname.startsWith('/did:plc:')) {
      asked.push('plc');
      return Response.json({ service: [{ type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] });
    }

    if (url.pathname.endsWith('getRecord')) {
      const rkey = url.searchParams.get('rkey') ?? '';
      asked.push(`schema:${rkey}`);
      const found = PUBLISHED[rkey];
      if (!found) return new Response(JSON.stringify({ error: 'RecordNotFound' }), { status: 400 });
      return Response.json({ uri: `at://x/y/${rkey}`, cid: 'bafy', value: found.schema });
    }

    return new Response('unstubbed', { status: 500 });
  };
};

const base = { did: 'did:plc:ada', pds: 'https://pds.example', own: POST };
const RECORD_DEF = POST.schema.defs.main.record;
const schemasAsked = () => asked.filter((entry) => entry.startsWith('schema:')).map((entry) => entry.slice(7));
const by = (fields, name) => fields.find((field) => field.name === name);

// ---- what gets fetched ----------------------------------------------------

test('a record that reaches nothing fetches nothing', async () => {
  install();

  const fields = await fieldsFor({ text: 'hello' }, RECORD_DEF, base, createTrace());

  assert.deepEqual(schemasAsked(), []);
  assert.equal(by(fields, 'text').text, 'hello');
});

test('only the schema the record reaches, not the eight it could have', async () => {
  install();

  // `reply` reaches `#replyRef`, which is local and free, and that reaches
  // `example.atlas.strongref`. Nothing here touches image, video or label.
  await fieldsFor({ text: 'x', reply: { root: { uri: 'at://did:plc:b/x.y.z/1' } } }, RECORD_DEF, base, createTrace());

  assert.deepEqual(schemasAsked(), ['example.atlas.strongref']);
});

test('a union fetches the member the value says it is, not every member', async () => {
  install();

  await fieldsFor({ embed: { $type: 'example.atlas.image', images: [] } }, RECORD_DEF, base, createTrace());

  assert.deepEqual(schemasAsked(), ['example.atlas.image']);
});

test('a schema nobody published is asked for once, not once per round', async () => {
  install();

  await fieldsFor({ labels: { some: 'value' } }, RECORD_DEF, base, createTrace());

  assert.deepEqual(schemasAsked(), ['example.atlas.label']);
});

// ---- that it still renders the same ---------------------------------------

test('following a ref lazily describes the field it points at', async () => {
  install();

  const fields = await fieldsFor(
    { reply: { root: { uri: 'at://did:plc:b/x.y.z/1' } } },
    RECORD_DEF,
    base,
    createTrace(),
  );

  // Without the fetch this is a string nothing described. With it, a link.
  assert.equal(by(fields, 'uri').kind, 'at-uri');
  assert.equal(by(fields, 'uri').href, '/at/did:plc:b/x.y.z/1');
});

test('a #local ref inside a fetched document resolves against that document', async () => {
  // The bug this pins down: `#item` is local to `example.atlas.image`, and
  // resolving it against the record's own lexicon finds nothing. On the live
  // network that is why an image's alt text rendered as a field with no
  // description, on the one field of an image that most needs one.
  install();

  const fields = await fieldsFor(
    { embed: { $type: 'example.atlas.image', images: [{ alt: 'A cat, asleep.' }] } },
    RECORD_DEF,
    base,
    createTrace(),
  );

  const alt = by(fields, 'alt');
  assert.equal(alt.kind, 'prose', 'maxGraphemes comes from #item in the image document');
  assert.equal(alt.meta.maxGraphemes, 100);
  assert.notEqual(alt.kind, 'unknown');
});

test('a record whose schemas are all unreachable still renders every field', async () => {
  install();
  globalThis.fetch = async () => new Response('down', { status: 503 });

  const fields = await fieldsFor(
    { text: 'still here', embed: { $type: 'example.atlas.image', images: [] } },
    RECORD_DEF,
    base,
    createTrace(),
  );

  assert.equal(by(fields, 'text').text, 'still here');
  assert.equal(by(fields, 'embed').kind, 'group');
});
