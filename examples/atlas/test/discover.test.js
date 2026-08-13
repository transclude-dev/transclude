// The two indexes.
//
// What these mostly check is that a page survives them. Neither service belongs
// to this app, neither is the network itself, and a schema page should render
// whether or not a relay in another datacenter is having a good afternoon.

import test from 'node:test';
import assert from 'node:assert/strict';

import { clearCache } from '../app/lib/cache.js';
import { backlinks, linkingRecords, reposUsing } from '../app/lib/discover.js';
import { createTrace } from '../app/lib/trace.js';

/** @type {(url: string) => Response|Promise<Response>} */
let handler = () => new Response('unstubbed', { status: 500 });

const install = (fn) => {
  clearCache();
  handler = fn;
  globalThis.fetch = async (input) => handler(String(input));
};

const down = () => new Response('nope', { status: 503 });

// ---- who uses a collection ------------------------------------------------

test('the relay names repositories, and the DIDs come out in order', async () => {
  install(() => Response.json({ cursor: 'x', repos: [{ did: 'did:plc:a' }, { did: 'did:plc:b' }] }));

  assert.deepEqual(await reposUsing('app.bsky.feed.post', 12, createTrace()), ['did:plc:a', 'did:plc:b']);
});

test('the collection reaches the relay as a query parameter, encoded', async () => {
  let asked = '';
  install((url) => {
    asked = url;
    return Response.json({ repos: [] });
  });

  await reposUsing('app.bsky.feed.post', 5, createTrace());

  assert.match(asked, /listReposByCollection\?collection=app\.bsky\.feed\.post&limit=5/);
});

test('a relay that is down leaves the page without a list, not without a page', async () => {
  install(down);

  assert.deepEqual(await reposUsing('app.bsky.feed.post', 12, createTrace()), []);
});

test('the relay appears in the trace under its own name', async () => {
  // A reader should be able to see which lines on a page came from an index
  // rather than from the thing itself.
  install(() => Response.json({ repos: [] }));
  const trace = createTrace();

  await reposUsing('app.bsky.feed.post', 12, trace);

  assert.equal(trace.hops[0].label, 'Relay');
});

// ---- what points at something ---------------------------------------------

const LINKS = {
  links: {
    'app.bsky.graph.follow': { '.subject': 12989007 },
    'app.bsky.graph.block': { '.subject': 10473 },
    'sky.write.on.pages': { '.authorDid': 0 },
    'com.example.two': { '.a': 5, '.b': 90 },
  },
};

test('counts are flattened per field, biggest first', async () => {
  install(() => Response.json(LINKS));

  const found = await backlinks('did:plc:abc', createTrace());

  assert.deepEqual(
    found.map((link) => [link.collection, link.path, link.count]),
    [
      ['app.bsky.graph.follow', '.subject', 12989007],
      ['app.bsky.graph.block', '.subject', 10473],
      ['com.example.two', '.b', 90],
      ['com.example.two', '.a', 5],
    ],
  );
});

test('a collection with nothing pointing is left out', async () => {
  // The index lists names it has seen with a count of zero. A row saying "0"
  // is noise on a page whose whole job is what is actually there.
  install(() => Response.json(LINKS));

  const found = await backlinks('did:plc:abc', createTrace());

  assert.equal(found.some((link) => link.collection === 'sky.write.on.pages'), false);
});

test('each row links to the lexicon for the collection that points', async () => {
  install(() => Response.json(LINKS));

  const [first] = await backlinks('did:plc:abc', createTrace());

  assert.equal(first.href, '/lexicon/app.bsky.graph.follow');
});

test('the target is sent encoded, so an at:// URI survives the query string', async () => {
  let asked = '';
  install((url) => {
    asked = url;
    return Response.json({ links: {} });
  });

  await backlinks('at://did:plc:abc/app.bsky.feed.post/3k2j', createTrace());

  assert.match(asked, /target=at%3A%2F%2Fdid%3Aplc%3Aabc%2Fapp\.bsky\.feed\.post%2F3k2j/);
});

test('an index that is down is no backlinks, not a broken page', async () => {
  install(down);

  assert.deepEqual(await backlinks('did:plc:abc', createTrace()), []);
});

// ---- the records themselves -----------------------------------------------

test('linking records come back addressable', async () => {
  install(() =>
    Response.json({
      total: 2,
      cursor: 'next',
      linking_records: [
        { did: 'did:plc:a', collection: 'app.bsky.feed.like', rkey: '3k2j' },
        { did: 'did:plc:b', collection: 'app.bsky.feed.like', rkey: '3k2k' },
      ],
    }),
  );

  const page = await linkingRecords('at://x', { collection: 'app.bsky.feed.like', path: '.subject.uri' }, createTrace());

  assert.equal(page.total, 2);
  assert.equal(page.cursor, 'next');
  assert.equal(page.records[0].href, '/at/did:plc:a/app.bsky.feed.like/3k2j');
});

test('a cursor is passed through untouched', async () => {
  // It is the index's own, and inventing a page number over it would be a
  // second paging scheme disagreeing with the first.
  let asked = '';
  install((url) => {
    asked = url;
    return Response.json({ linking_records: [] });
  });

  await linkingRecords('at://x', { collection: 'c.d.e', path: '.f', cursor: 'fc6748eb00' }, createTrace());

  assert.match(asked, /cursor=fc6748eb00/);
});

test('a failure here is an empty page, with the shape the caller expects', async () => {
  install(down);

  const page = await linkingRecords('at://x', { collection: 'c.d.e', path: '.f' }, createTrace());

  assert.deepEqual(page, { total: 0, cursor: null, records: [] });
});

// ---- politeness -----------------------------------------------------------

test('a repeated question is asked once', async () => {
  // These are somebody else's servers, and this app can send a lot of traffic
  // at them. Ten minutes is the politest number in `cache.js`.
  let calls = 0;
  install(() => {
    calls++;
    return Response.json({ links: {} });
  });

  await backlinks('did:plc:abc', createTrace());
  await backlinks('did:plc:abc', createTrace());

  assert.equal(calls, 1);
});
