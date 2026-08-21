// What a hostname resolves to, which is the one check the core cannot make.
//
// `src/address.js` decides what an address means and imports nothing. This
// turns a name into addresses, so it needs a resolver, and the resolver arrives
// as a dependency. No test here touches DNS.
//
// This is the layer behind the allowlist. A name nobody allowed never reaches
// it, so everything below is about a name that was allowed and answers with an
// address it should not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { nodeLookup } from '../src/lookup.js';

/** A resolver answering from a table, recording what it was asked for. */
function fakeResolver(table) {
  const calls = [];
  const resolver = {
    async lookup(hostname, options) {
      calls.push({ hostname, options });
      const answer = table[hostname];
      if (!answer) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      return answer.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    },
  };
  return { resolver, calls };
}

// ---- a name that is fine ---------------------------------------------------

test('a name answering with public addresses is allowed', async () => {
  const { resolver } = fakeResolver({ 'source.example': ['93.184.216.34', '2606:2800:220:1::1'] });
  const lookup = nodeLookup({ resolver });

  assert.equal(await lookup('source.example'), null);
});

test('every address is asked for, not the first one', async () => {
  // `{ all: true }` is the whole reason this holds. Without it the resolver
  // answers with one address and the second one goes unchecked.
  const { resolver, calls } = fakeResolver({ 'source.example': ['93.184.216.34'] });
  await nodeLookup({ resolver })('source.example');

  assert.deepEqual(calls, [{ hostname: 'source.example', options: { all: true } }]);
});

// ---- a name that is not ----------------------------------------------------

test('a name answering with a private address is refused, and says which', async () => {
  const { resolver } = fakeResolver({ 'inside.example': ['10.0.0.1'] });

  assert.equal(await nodeLookup({ resolver })('inside.example'), '10.0.0.1, which is private');
});

test('a public address first does not excuse a private one after it', async () => {
  // The attack this exists for: a name that answers with one address a check
  // would pass and one it would not. Which of the two the connection uses is
  // not ours to decide, so either one refuses the fetch.
  const { resolver } = fakeResolver({ 'mixed.example': ['93.184.216.34', '127.0.0.1'] });

  assert.equal(await nodeLookup({ resolver })('mixed.example'), '127.0.0.1, which is loopback');
});

test('the metadata endpoint is refused by name', async () => {
  const { resolver } = fakeResolver({ 'metadata.example': ['169.254.169.254'] });

  assert.equal(
    await nodeLookup({ resolver })('metadata.example'),
    '169.254.169.254, which is link-local, and the metadata endpoint',
  );
});

test('an IPv4 address wearing an IPv6 hat is refused', async () => {
  const { resolver } = fakeResolver({ 'mapped.example': ['::ffff:10.0.0.1'] });

  assert.equal(
    await nodeLookup({ resolver })('mapped.example'),
    '::ffff:10.0.0.1, which is private, through an IPv4-mapped address',
  );
});

// ---- the edges -------------------------------------------------------------

test('a literal address is decided without asking the resolver', async () => {
  // `checkUrl` already ruled on a literal before this runs. Asking a resolver
  // for an address is a question with no answer.
  const { resolver, calls } = fakeResolver({});

  assert.equal(await nodeLookup({ resolver })('127.0.0.1'), 'loopback');
  assert.deepEqual(calls, []);
});

test('a name that does not resolve is not this check refusing it', async () => {
  // The fetch fails on its own and says so in its own words. Answering with a
  // reason here would put a DNS failure in a 403 about addresses.
  const { resolver } = fakeResolver({});

  assert.equal(await nodeLookup({ resolver })('gone.example'), null);
});

test('a name answering with nothing at all is allowed through', async () => {
  const { resolver } = fakeResolver({ 'empty.example': [] });

  assert.equal(await nodeLookup({ resolver })('empty.example'), null);
});
