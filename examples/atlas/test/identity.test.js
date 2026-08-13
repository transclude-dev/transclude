// The resolution chain, over a stubbed network.
//
// `fetch` is replaced rather than the modules being mocked, so what these tests
// exercise is the real code down to the request it would have sent. A test that
// fails here fails because the chain is wrong, not because a stub drifted.
//
// Nothing here touches the live network. The one thing that cannot be checked
// this way is whether the real endpoints still answer in this shape, and that
// belongs in a check somebody runs on purpose rather than in `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { clearCache } from '../app/lib/cache.js';
import { claimedHandle, didWebUrl, pdsFrom, resolveIdentity } from '../app/lib/identity.js';
import { createTrace } from '../app/lib/trace.js';

// ---- the stub -------------------------------------------------------------

const docFor = (did, handle, pds = 'https://pds.example') => ({
  id: did,
  alsoKnownAs: handle ? [`at://${handle}`] : [],
  service: [
    { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds },
  ],
});

const txtAnswer = (value) => ({ Status: 0, Answer: [{ type: 16, data: `"${value}"` }] });
const nxdomain = { Status: 3 };

/** @type {Map<string, unknown>} */
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
      if (body === 404) return new Response('no', { status: 404 });
      if (typeof body === 'string') return new Response(body, { status: 200 });
      return Response.json(body);
    }

    return new Response('unstubbed', { status: 500 });
  };
};

const doh = (name) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}`;

// ---- the pure parts -------------------------------------------------------

test('the PDS is the service entry with the atproto type', () => {
  assert.equal(pdsFrom(docFor('did:plc:a', 'ada.example')), 'https://pds.example');
  // A trailing slash would make every XRPC URL carry a double slash.
  assert.equal(pdsFrom(docFor('did:plc:a', 'a', 'https://pds.example/')), 'https://pds.example');
});

test('a document with no PDS is an identity with nothing to read', () => {
  assert.throws(() => pdsFrom({ service: [] }), /names no personal data server/);
  assert.throws(() => pdsFrom({}), /names no personal data server/);
});

test('the claimed handle comes off alsoKnownAs, and is only a claim', () => {
  assert.equal(claimedHandle(docFor('did:plc:a', 'ada.example')), 'ada.example');
  assert.equal(claimedHandle(docFor('did:plc:a', null)), null);
});

test('a did:web maps its colons to path segments', () => {
  assert.equal(didWebUrl('did:web:example.com'), 'https://example.com/.well-known/did.json');
  assert.equal(didWebUrl('did:web:example.com:u:ada'), 'https://example.com/u/ada/did.json');
});

// ---- the chain ------------------------------------------------------------

test('a handle resolves by DNS, and the document confirms it', async () => {
  install({
    [doh('_atproto.ada.example')]: txtAnswer('did=did:plc:ada'),
    'https://plc.directory/did:plc:ada': docFor('did:plc:ada', 'ada.example'),
  });

  const identity = await resolveIdentity('ada.example', createTrace());

  assert.equal(identity.did, 'did:plc:ada');
  assert.equal(identity.handle, 'ada.example');
  assert.equal(identity.verified, true);
  assert.equal(identity.pds, 'https://pds.example');
});

test('a handle with no TXT record falls through to the well-known file', async () => {
  install({
    [doh('_atproto.ada.example')]: nxdomain,
    'https://ada.example/.well-known/atproto-did': 'did:plc:ada',
    'https://plc.directory/did:plc:ada': docFor('did:plc:ada', 'ada.example'),
  });

  const identity = await resolveIdentity('ada.example', createTrace());

  assert.equal(identity.did, 'did:plc:ada');
  assert.equal(identity.verified, true);
});

test('a document claiming a handle that does not lead back is unverified', async () => {
  // The case this app exists to show. The document says "ada.example". Ada's
  // own DNS says that name belongs to somebody else.
  install({
    'https://plc.directory/did:plc:impostor': docFor('did:plc:impostor', 'ada.example'),
    [doh('_atproto.ada.example')]: txtAnswer('did=did:plc:ada'),
  });

  const identity = await resolveIdentity('did:plc:impostor', createTrace());

  assert.equal(identity.handle, 'ada.example');
  assert.equal(identity.verified, false);
  // It still resolves. Refusing would hide the more interesting of the two.
  assert.equal(identity.pds, 'https://pds.example');
});

test('a handle that resolves nowhere is unverified, not an error', async () => {
  install({
    'https://plc.directory/did:plc:ada': docFor('did:plc:ada', 'gone.example'),
    [doh('_atproto.gone.example')]: nxdomain,
    'https://gone.example/.well-known/atproto-did': 404,
  });

  const identity = await resolveIdentity('did:plc:ada', createTrace());

  assert.equal(identity.verified, false);
  assert.equal(identity.did, 'did:plc:ada');
});

test('two TXT records naming different DIDs resolve to neither', async () => {
  // Picking one would mean a name resolves differently for different visitors.
  install({
    [doh('_atproto.ada.example')]: {
      Status: 0,
      Answer: [
        { type: 16, data: '"did=did:plc:one"' },
        { type: 16, data: '"did=did:plc:two"' },
      ],
    },
    'https://ada.example/.well-known/atproto-did': 404,
  });

  await assert.rejects(() => resolveIdentity('ada.example', createTrace()), /publishes no DID/);
});

test('an unknown DID method says so instead of guessing a URL', async () => {
  install({});

  await assert.rejects(
    () => resolveIdentity('did:key:zabc', createTrace()),
    /cannot resolve/,
  );
});

// ---- the trace ------------------------------------------------------------

test('every hop is recorded, in the order it was made', async () => {
  install({
    [doh('_atproto.ada.example')]: txtAnswer('did=did:plc:ada'),
    'https://plc.directory/did:plc:ada': docFor('did:plc:ada', 'ada.example'),
  });

  const trace = createTrace();
  await resolveIdentity('ada.example', trace);

  assert.deepEqual(trace.hops.map((hop) => hop.label), ['DNS', 'PLC directory']);
  assert.equal(trace.hops.every((hop) => hop.ok), true);
  assert.equal(trace.hops[0].detail, '_atproto.ada.example');
});

test('a failed hop is kept, because it is the useful line', async () => {
  install({
    [doh('_atproto.ada.example')]: nxdomain,
    'https://ada.example/.well-known/atproto-did': 404,
  });

  const trace = createTrace();
  await assert.rejects(() => resolveIdentity('ada.example', trace));

  const last = trace.hops.at(-1);
  assert.equal(last.label, 'Well-known');
  assert.equal(last.ok, true);
  // The lookup answered; it just answered "nobody". The throw is above it.
  assert.equal(trace.hops.length, 2);
});

test('a second read of the same DID is a cache hit, and says so', async () => {
  install({
    'https://plc.directory/did:plc:ada': docFor('did:plc:ada', 'ada.example'),
    [doh('_atproto.ada.example')]: txtAnswer('did=did:plc:ada'),
  });

  await resolveIdentity('did:plc:ada', createTrace());
  const before = asked.length;

  const trace = createTrace();
  await resolveIdentity('did:plc:ada', createTrace());

  assert.equal(asked.length, before, 'the second read sent no request');

  await resolveIdentity('did:plc:ada', trace);
  assert.equal(trace.hops[0].cache, 'hit');
});
