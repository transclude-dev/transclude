// Finding a schema, and what to do when there is none.
//
// The stub is written out again rather than shared with `identity.test.js`.
// The two care about different halves of the network — that one about DNS
// shapes, this one about what a repository answers — and a helper that served
// both would be a third thing to keep in step with the two it replaced.

import test from 'node:test';
import assert from 'node:assert/strict';

import { clearCache } from '../app/lib/cache.js';
import { defIn, recordDef, referencedNsids, resolveLexicon, resolveMany } from '../app/lib/lexicon.js';
import { createTrace } from '../app/lib/trace.js';

// ---- fixtures -------------------------------------------------------------

const SCHEMA = {
  id: 'example.atlas.test.thing',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        required: ['note'],
        properties: {
          note: { type: 'string' },
          root: { type: 'ref', ref: 'com.atproto.repo.strongRef' },
          inner: { type: 'ref', ref: '#detail' },
          embed: { type: 'union', refs: ['example.atlas.embed.image', 'example.atlas.embed.link#view'] },
        },
      },
    },
    detail: { type: 'object', properties: { label: { type: 'string' } } },
  },
};

const doc = (pds = 'https://pds.example') => ({
  service: [{ type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }],
});

/** @type {Map<string, any>} */
let routes = new Map();
/** @type {string[]} */
let asked = [];

const install = (pairs) => {
  routes = new Map(Object.entries(pairs));
  asked = [];
  clearCache();

  globalThis.fetch = async (input) => {
    const url = String(input);
    asked.push(url);

    for (const [pattern, body] of routes) {
      if (!url.startsWith(pattern)) continue;
      if (body === 400) return new Response(JSON.stringify({ error: 'RecordNotFound' }), { status: 400 });
      return Response.json(body);
    }

    return new Response('unstubbed', { status: 500 });
  };
};

const doh = (name) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}`;
const txtAnswer = (value) => ({ Status: 0, Answer: [{ type: 16, data: `"${value}"` }] });
const nxdomain = { Status: 3 };

const schemaRecord = (nsid, schema) => ({
  uri: `at://did:plc:pub/com.atproto.lexicon.schema/${nsid}`,
  cid: 'bafyabc',
  value: schema,
});

// ---- resolving ------------------------------------------------------------

test('the whole chain: DNS, the publisher, then the record', async () => {
  // `example.atlas.test.thing` is published by whoever controls
  // `test.atlas.example`. Nothing else in the app decides this.
  install({
    [doh('_lexicon.test.atlas.example')]: txtAnswer('did=did:plc:pub'),
    'https://plc.directory/did:plc:pub': doc(),
    'https://pds.example/xrpc/com.atproto.repo.getRecord': schemaRecord('example.atlas.test.thing', SCHEMA),
  });

  const lexicon = await resolveLexicon('example.atlas.test.thing', createTrace());

  assert.equal(lexicon.nsid, 'example.atlas.test.thing');
  assert.equal(lexicon.did, 'did:plc:pub');
  assert.equal(lexicon.schema.id, 'example.atlas.test.thing');
});

test('resolution walks up when the closest domain answers with nothing', async () => {
  // Both `_lexicon.feed.bsky.app` and `_lexicon.bsky.app` exist on the live
  // network, so stopping at the first name that resolves is not enough.
  install({
    [doh('_lexicon.test.atlas.example')]: nxdomain,
    [doh('_lexicon.atlas.example')]: txtAnswer('did=did:plc:pub'),
    'https://plc.directory/did:plc:pub': doc(),
    'https://pds.example/xrpc/com.atproto.repo.getRecord': schemaRecord('example.atlas.test.thing', SCHEMA),
  });

  const lexicon = await resolveLexicon('example.atlas.test.thing', createTrace());

  assert.equal(lexicon.did, 'did:plc:pub');
});

test('a domain that answers but holds no record keeps walking up', async () => {
  install({
    [doh('_lexicon.test.atlas.example')]: txtAnswer('did=did:plc:empty'),
    [doh('_lexicon.atlas.example')]: txtAnswer('did=did:plc:pub'),
    'https://plc.directory/did:plc:empty': doc('https://empty.example'),
    'https://empty.example/xrpc/com.atproto.repo.getRecord': 400,
    'https://plc.directory/did:plc:pub': doc(),
    'https://pds.example/xrpc/com.atproto.repo.getRecord': schemaRecord('example.atlas.test.thing', SCHEMA),
  });

  const lexicon = await resolveLexicon('example.atlas.test.thing', createTrace());

  assert.equal(lexicon.did, 'did:plc:pub');
});

test('nobody publishing one is null, not an error', async () => {
  // Most record types on this network have no published schema. Throwing here
  // would turn a record that renders imperfectly into a page that does not.
  install({
    [doh('_lexicon.test.atlas.example')]: nxdomain,
    [doh('_lexicon.atlas.example')]: nxdomain,
  });

  assert.equal(await resolveLexicon('example.atlas.test.thing', createTrace()), null);
});

test('several are resolved at once, and each name is asked for once', async () => {
  install({
    [doh('_lexicon.test.atlas.example')]: txtAnswer('did=did:plc:pub'),
    'https://plc.directory/did:plc:pub': doc(),
    'https://pds.example/xrpc/com.atproto.repo.getRecord': schemaRecord('example.atlas.test.thing', SCHEMA),
  });

  const found = await resolveMany(
    ['example.atlas.test.thing', 'example.atlas.test.thing', 'not-an-nsid'],
    createTrace(),
  );

  assert.deepEqual(Object.keys(found), ['example.atlas.test.thing']);
  // Asked once, not twice, and the name that is not an NSID never went out.
  assert.equal(asked.filter((url) => url.includes('getRecord')).length, 1);
});

test('one that resolves to nothing is left out rather than recorded as null', async () => {
  install({ [doh('_lexicon.test.atlas.example')]: nxdomain, [doh('_lexicon.atlas.example')]: nxdomain });

  assert.deepEqual(await resolveMany(['example.atlas.test.thing'], createTrace()), {});
});

// ---- reading a schema -----------------------------------------------------

const lexicon = { nsid: 'example.atlas.test.thing', schema: SCHEMA };

test('a record def is one level deeper than every other kind', () => {
  assert.equal(recordDef(lexicon).properties.note.type, 'string');
  // `main` here is a record, so `defIn` unwraps it too.
  assert.equal(defIn(lexicon, 'example.atlas.test.thing').properties.note.type, 'string');
  // Any other def is the object itself.
  assert.equal(defIn(lexicon, '#detail').properties.label.type, 'string');
});

test('a lexicon that defines no record has no record def', () => {
  assert.equal(recordDef({ nsid: 'x.y.z', schema: { defs: { main: { type: 'query' } } } }), null);
  assert.equal(recordDef(null), null);
});

test('every other schema this one points at, for the dependency links', () => {
  // Refs sit at any depth, and a union carries several. The def after `#` is
  // not part of the name, and a local ref is not a dependency.
  assert.deepEqual(referencedNsids(lexicon), [
    'com.atproto.repo.strongRef',
    'example.atlas.embed.image',
    'example.atlas.embed.link',
  ]);
});
