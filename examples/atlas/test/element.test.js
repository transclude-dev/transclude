// <at-record>, as far as Node can see it.
//
// The file guards its class definition on `HTMLElement` existing, so importing
// it here gets the URL builder and defines nothing. That is the half worth
// testing without a browser: everything else in the element is a fetch, an
// insert, and an abort, and none of those have rules of their own to get wrong.
//
// The half this cannot reach — that the tag defines, that the fallback survives
// a failure, that JavaScript off leaves the page alone — is checked in a
// browser against `npm run atlas`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { embedUrl } from '../app/public/at-record.js';

const HOST = 'https://atlas.example';
const URI = 'at://did:plc:abc/app.bsky.feed.post/3k2j';

test('an at:// URI becomes an embed URL asking for the record fragment', () => {
  assert.equal(
    embedUrl(URI, { host: HOST }),
    'https://atlas.example/embed/did:plc:abc/app.bsky.feed.post/3k2j?fragment=record',
  );
});

test('the at:// prefix is optional, the same as everywhere else here', () => {
  assert.equal(embedUrl('did:plc:abc/app.bsky.feed.post/3k2j', { host: HOST }), embedUrl(URI, { host: HOST }));
});

test('a different fragment is asked for by name', () => {
  assert.match(embedUrl(URI, { host: HOST, fragment: 'raw' }), /\?fragment=raw$/);
});

test('a URI that does not name one record is refused, and says how many parts it had', () => {
  // A collection has fifty records in it. Dropping one into somebody's article
  // because the tag was one segment short is worth an error.
  assert.throws(() => embedUrl('did:plc:abc/app.bsky.feed.post', { host: HOST }), /names 2 parts/);
  assert.throws(() => embedUrl('did:plc:abc', { host: HOST }), /names 1 parts/);
  assert.throws(() => embedUrl('', { host: HOST }), /needs a uri/);
  assert.throws(() => embedUrl(null, { host: HOST }), /needs a uri/);
});

test('the host is whatever the tag was told', () => {
  assert.match(embedUrl(URI, { host: 'https://atlas.example.test' }), /^https:\/\/atlas\.example\.test\/embed\//);
});

// ---- the file itself ------------------------------------------------------

const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/public/at-record.js'),
  'utf8',
);

test('the element has no shadow root, and that is the whole point', () => {
  // A shadow root would keep the host page's stylesheet out of the record, and
  // that stylesheet reaching it is the reason this serves HTML and not an
  // iframe. This is a one-line change somebody could make without noticing.
  assert.doesNotMatch(source, /attachShadow/);
});

test('it ships on its own, with nothing to install alongside it', () => {
  // No bare imports. A page that adds one script tag gets a working element,
  // and a bundler is never part of the story.
  assert.doesNotMatch(source, /^import .* from ['"][^.]/m);
});

test('a failure leaves the author\'s fallback where it is', () => {
  // Replacing the children with an error message would put this app's problem
  // in somebody else's article.
  assert.doesNotMatch(source, /innerHTML\s*=\s*['"`]/);
});
