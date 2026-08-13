// AT-URIs and NSIDs. No network, so these run everywhere and are where the
// parsing rules are pinned down.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isDid, isNsid, kindOf, nsidAuthorities, nsidAuthority, parseAtUri } from '../app/lib/aturi.js';

// ---- parsing --------------------------------------------------------------

test('one URI names three things, and which one is the number of parts', () => {
  assert.equal(kindOf(parseAtUri('at://bsky.app')), 'repo');
  assert.equal(kindOf(parseAtUri('at://bsky.app/app.bsky.feed.post')), 'collection');
  assert.equal(kindOf(parseAtUri('at://bsky.app/app.bsky.feed.post/3k2j')), 'record');
});

test('the at:// prefix is optional, because the path form drops it', () => {
  const withPrefix = parseAtUri('at://did:plc:abc/app.bsky.feed.post/3k2j');
  const without = parseAtUri('did:plc:abc/app.bsky.feed.post/3k2j');

  assert.deepEqual(withPrefix, without);
  assert.equal(withPrefix.authority, 'did:plc:abc');
  assert.equal(withPrefix.collection, 'app.bsky.feed.post');
  assert.equal(withPrefix.rkey, '3k2j');
});

test('href and uri agree, so a link and a copied address are the same thing', () => {
  const at = parseAtUri('at://bsky.app/app.bsky.feed.post/3k2j');

  assert.equal(at.href, '/at/bsky.app/app.bsky.feed.post/3k2j');
  assert.equal(at.uri, 'at://bsky.app/app.bsky.feed.post/3k2j');
});

test('a fourth part is refused rather than dropped', () => {
  // Dropping it would render a different record than the one that was asked
  // for, and say nothing about it.
  assert.throws(() => parseAtUri('at://bsky.app/app.bsky.feed.post/3k2j/extra'), /at most three/);
});

test('a collection that is not an NSID is refused', () => {
  assert.throws(() => parseAtUri('at://bsky.app/posts'), /not an NSID/);
});

test('nothing is refused, and so is a bare prefix', () => {
  assert.throws(() => parseAtUri(''), /needs an authority/);
  assert.throws(() => parseAtUri('at://'), /needs an authority/);
});

// ---- NSIDs ----------------------------------------------------------------

test('an NSID needs a domain and a name', () => {
  assert.equal(isNsid('app.bsky.feed.post'), true);
  assert.equal(isNsid('com.atproto.repo.getRecord'), true);
  // Two segments is a domain with no name.
  assert.equal(isNsid('bsky.app'), false);
  assert.equal(isNsid('posts'), false);
  // The name is not a domain label, so it carries no digits and no hyphen.
  assert.equal(isNsid('app.bsky.feed.post2'), false);
  assert.equal(isNsid('app.bsky.feed.a-post'), false);
});

test('the authority is every segment but the name, reversed', () => {
  // Checked against the live record: _lexicon.feed.bsky.app answers for this.
  assert.equal(nsidAuthority('app.bsky.feed.post'), 'feed.bsky.app');
  assert.equal(nsidAuthority('com.atproto.repo.getRecord'), 'repo.atproto.com');
});

test('resolution walks up, most specific first', () => {
  // Both of these are published in practice and they need not agree, so the
  // order is the rule rather than a preference.
  assert.deepEqual(nsidAuthorities('app.bsky.feed.post'), ['feed.bsky.app', 'bsky.app']);
  // It stops at two labels. A single label is a TLD and answers for nobody.
  assert.deepEqual(nsidAuthorities('app.example.thing'), ['example.app']);
});

// ---- DIDs -----------------------------------------------------------------

test('a DID is told from a handle by its scheme, not by its shape', () => {
  assert.equal(isDid('did:plc:z72i7hdynmk6r22z27h6tvur'), true);
  assert.equal(isDid('did:web:example.com'), true);
  assert.equal(isDid('bsky.app'), false);
  assert.equal(isDid('did:'), false);
});
