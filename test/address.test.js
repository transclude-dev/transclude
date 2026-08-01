// Which addresses a server may be asked to fetch from.
//
// This is the suite that has to be green before any network code runs at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { allowedHost, blockedAddress, checkUrl, parseV4, parseV6 } from '../src/address.js';

const ALLOW = { allow: ['source.example', '*.docs.example'] };

// ---- reading an address ----------------------------------------------------

test('a dotted quad parses, and near misses do not', () => {
  assert.deepEqual(parseV4('192.168.0.1'), [192, 168, 0, 1]);
  assert.equal(parseV4('192.168.0'), null);
  assert.equal(parseV4('192.168.0.256'), null);
  assert.equal(parseV4('192.168.0.1.1'), null);
  assert.equal(parseV4('example.com'), null);
  assert.equal(parseV4('0x7f.0.0.1'), null);
});

test('the compressed v6 forms parse', () => {
  assert.deepEqual(parseV6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseV6('::'), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(parseV6('2001:db8::1'), [0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]);
  assert.equal(parseV6('gggg::1'), null);
  assert.equal(parseV6('1::2::3'), null);
});

// ---- what is refused -------------------------------------------------------

test('the private ranges are refused', () => {
  for (const host of ['10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1']) {
    assert.match(blockedAddress(host), /private/, host);
  }
});

test('loopback is refused, in both families', () => {
  assert.match(blockedAddress('127.0.0.1'), /loopback/);
  assert.match(blockedAddress('127.255.255.254'), /loopback/);
  assert.match(blockedAddress('::1'), /loopback/);
});

test('the metadata endpoint is refused', () => {
  // The address worth naming on its own: it hands out credentials to anything
  // on the host that asks.
  assert.match(blockedAddress('169.254.169.254'), /metadata/);
});

test('an IPv4 address wearing an IPv6 hat is refused', () => {
  // The obvious way past a checker that only reads the hex form.
  assert.match(blockedAddress('::ffff:169.254.169.254'), /metadata.*IPv4-mapped/);
  assert.match(blockedAddress('::ffff:10.0.0.1'), /private.*IPv4-mapped/);
});

test('the other v6 ranges that are not the public internet are refused', () => {
  assert.match(blockedAddress('fc00::1'), /unique local/);
  assert.match(blockedAddress('fd12:3456::1'), /unique local/);
  assert.match(blockedAddress('fe80::1'), /link-local/);
  assert.match(blockedAddress('::'), /unspecified/);
});

test('the odd corners are refused too', () => {
  assert.match(blockedAddress('0.0.0.0'), /this network/);
  assert.match(blockedAddress('100.64.0.1'), /NAT/);
  assert.match(blockedAddress('224.0.0.1'), /multicast/);
  assert.match(blockedAddress('255.255.255.255'), /multicast|reserved/);
});

test('a public address is not refused', () => {
  for (const host of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1::1']) {
    assert.equal(blockedAddress(host), null, host);
  }
});

test('a name is not an address, and this says nothing about one', () => {
  // Where a name points is the runtime's question. This one only reads
  // addresses, and a name that is not one is not its business.
  assert.equal(blockedAddress('example.com'), null);
  assert.equal(blockedAddress('localhost'), null);
});

// ---- the allowlist ---------------------------------------------------------

test('nothing is allowed by default', () => {
  assert.equal(allowedHost('source.example', []), false);
  assert.equal(allowedHost('source.example'), false);
});

test('an exact host matches, and a lookalike does not', () => {
  assert.equal(allowedHost('source.example', ['source.example']), true);
  assert.equal(allowedHost('SOURCE.EXAMPLE', ['source.example']), true);
  assert.equal(allowedHost('evil-source.example', ['source.example']), false);
  assert.equal(allowedHost('source.example.evil.com', ['source.example']), false);
});

test('a wildcard covers subdomains and not the apex', () => {
  // Naming `*.docs.example` should not quietly hand over `docs.example` too.
  assert.equal(allowedHost('a.docs.example', ['*.docs.example']), true);
  assert.equal(allowedHost('a.b.docs.example', ['*.docs.example']), true);
  assert.equal(allowedHost('docs.example', ['*.docs.example']), false);
  assert.equal(allowedHost('notdocs.example', ['*.docs.example']), false);
});

test('a trailing dot is the same host', () => {
  assert.equal(allowedHost('source.example.', ['source.example']), true);
});

// ---- the one gate ----------------------------------------------------------

test('an allowed https URL passes', () => {
  assert.equal(checkUrl('https://source.example/guide', ALLOW), null);
  assert.equal(checkUrl('https://a.docs.example/x', ALLOW), null);
});

test('a host nobody allowed is refused', () => {
  assert.match(checkUrl('https://evil.example/x', ALLOW), /not an allowed host/);
});

test('only http and https are fetched', () => {
  for (const url of ['file:///etc/passwd', 'ftp://source.example/x', 'gopher://source.example/']) {
    assert.match(checkUrl(url, ALLOW), /not a scheme/, url);
  }
});

test('credentials in the URL are refused rather than forwarded', () => {
  assert.match(checkUrl('https://u:p@source.example/x', ALLOW), /credentials/);
});

test('something that is not a URL is refused', () => {
  assert.match(checkUrl('not a url', ALLOW), /not a URL/);
});

test('the allowlist is checked before the address', () => {
  // An allowed name that points somewhere private is caught by the resolver,
  // not here. A private literal that nobody allowed should be refused for the
  // reason that is true first.
  assert.match(checkUrl('http://127.0.0.1/x', ALLOW), /not an allowed host/);
});

test('an allowed host that is a private literal is still refused', () => {
  assert.match(
    checkUrl('http://127.0.0.1/x', { allow: ['127.0.0.1'] }),
    /loopback/,
  );
  assert.match(
    checkUrl('http://[::1]/x', { allow: ['[::1]'] }),
    /loopback/,
  );
});
