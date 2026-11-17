// A fake network for cases that include a document from another site.
//
// Loaded with `node --import` into the build, and imported by the case process
// before the app, when `SPEC_UPSTREAM` names a case's `upstream.json`. It
// replaces the two things the framework reaches the network through: `fetch`
// and `dns.promises.lookup`. Nothing in `src/` is touched, and no case resolves
// a real name or depends on what a real site says today.

import { promises as dns } from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.SPEC_UPSTREAM;
const fixture = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const reads = new Map();

// Where the case process reads the counts back. A symbol, so nothing in the
// app can collide with it by accident.
globalThis[Symbol.for('spec.upstream')] = { reads };

if (fixture) {
  globalThis.fetch = fakeFetch;
  dns.lookup = fakeLookup;
}

/**
 * A listed URL answers from its entry. Any other URL fails the way a network
 * that is down does, so a case about a source being unreachable lists nothing.
 *
 * @param {string|URL|Request} input
 * @param {RequestInit} [init]
 */
async function fakeFetch(input, init = {}) {
  const request = new Request(input, init);
  const url = request.url;
  reads.set(url, (reads.get(url) ?? 0) + 1);

  const entry = fixture.documents?.[url];
  if (!entry) throw new TypeError('fetch failed');

  const headers = new Headers(entry.headers ?? {});
  const etag = headers.get('etag');
  if (etag && request.headers.get('if-none-match') === etag) {
    // Counted on its own as well, so a case can tell a revalidation from a
    // second full read.
    reads.set(`304 ${url}`, (reads.get(`304 ${url}`) ?? 0) + 1);
    return new Response(null, { status: 304, headers: { etag } });
  }

  const body = entry.body ? fs.readFileSync(path.join(path.dirname(file), entry.body)) : null;
  if (body && !headers.has('content-type')) headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(body, { status: entry.status ?? 200, headers });
}

/**
 * A host in `addresses` resolves to what it names. Any other host resolves to
 * a public address, the one `example.com` has long had.
 *
 * @param {string} hostname
 * @param {{ all?: boolean }} [options]
 */
async function fakeLookup(hostname, options = {}) {
  const address = fixture.addresses?.[hostname] ?? '93.184.215.14';
  const family = address.includes(':') ? 6 : 4;
  const answer = { address, family };
  return options.all ? [answer] : answer;
}
