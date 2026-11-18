// Public files through `app.request()`, the way an app's own tests ask.
//
// A file of its own, because it must never load `@hono/node-server`'s `serve`.
// That module replaces the global `Response`, and with it in the process a header
// set after `serveStatic` built its answer still lands, so these would pass for
// the wrong reason. `serve.test.js` loads it for its real listener, and `node
// --test` gives each file its own process.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

import { publicFiles } from '../src/public-files.js';

const withPublicApp = async (fn, files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-public-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);

  const app = new Hono();
  app.use('*', publicFiles(path.relative(process.cwd(), dir)));
  try {
    return await fn(app);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('a type Hono does not know arrives typed through app.request()', async () => {
  await withPublicApp(
    async (app) => {
      const captions = await app.request('http://x/captions.vtt');
      assert.equal(captions.headers.get('content-type'), 'text/vtt; charset=utf-8');
      assert.match(captions.headers.get('etag') ?? '', /^W\//);
      assert.match(captions.headers.get('cache-control') ?? '', /must-revalidate/);

      const clip = await app.request('http://x/kitchen.m4a');
      assert.equal(clip.headers.get('content-type'), 'audio/mp4');
    },
    { 'captions.vtt': 'WEBVTT\n', 'kitchen.m4a': 'x'.repeat(500) },
  );
});

test('a range keeps the type through app.request()', async () => {
  await withPublicApp(
    async (app) => {
      const res = await app.request('http://x/kitchen.m4a', { headers: { range: 'bytes=0-99' } });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-type'), 'audio/mp4');
    },
    { 'kitchen.m4a': 'x'.repeat(500) },
  );
});

test('the validator back is a 304 through app.request()', async () => {
  await withPublicApp(
    async (app) => {
      const etag = (await app.request('http://x/kitchen.m4a')).headers.get('etag');
      const res = await app.request('http://x/kitchen.m4a', { headers: { 'if-none-match': etag } });
      assert.equal(res.status, 304);
    },
    { 'kitchen.m4a': 'x'.repeat(500) },
  );
});
