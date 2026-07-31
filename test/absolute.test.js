// `ctx.absolute('/og.png')`.
//
// A canonical URL, an og:image and a feed all have to be absolute. The request's
// own origin is the wrong answer twice: behind a proxy it is the internal one,
// and while prerendering there is no request.

import test from 'node:test';
import assert from 'node:assert/strict';

import { absoluteFrom } from '../src/document.js';

test('a root-relative path resolves against metadataBase', () => {
  const absolute = absoluteFrom('https://acme.com', 'http://localhost:3000/x');
  assert.equal(absolute('/og.png'), 'https://acme.com/og.png');
});

test('metadataBase wins over the request, which is the point behind a proxy', () => {
  // The request arrives on the internal origin. A canonical URL naming that is
  // worse than none.
  const absolute = absoluteFrom('https://acme.com', 'http://10.0.0.4:3000/post');
  assert.equal(absolute('/post'), 'https://acme.com/post');
});

test('with no metadataBase it falls back to the request', () => {
  const absolute = absoluteFrom(undefined, 'http://localhost:3000/x');
  assert.equal(absolute('/og.png'), 'http://localhost:3000/og.png');
});

test('an already absolute URL is returned untouched', () => {
  const absolute = absoluteFrom('https://acme.com', null);
  assert.equal(absolute('https://cdn.example/x.png'), 'https://cdn.example/x.png');
  assert.equal(absolute('mailto:a@b.c'), 'mailto:a@b.c');
});

test('prerendering with no metadataBase says what to set, rather than guessing', () => {
  // There is no request at build time, so there is no origin to fall back to.
  // A guessed one would be baked into a file.
  const absolute = absoluteFrom(undefined, null);
  assert.throws(() => absolute('/og.png'), /metadataBase/);
});

test('a relative path resolves against the page it is on', () => {
  const absolute = absoluteFrom(undefined, 'https://acme.com/blog/post');
  assert.equal(absolute('sibling'), 'https://acme.com/blog/sibling');
});
