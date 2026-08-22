// Draining on a stop signal, against a real listener.
//
// `drainOn` is handed the server and an `exit` spy, so nothing here sends a
// real signal to the test process. The one test about signal wiring emits a
// signal nothing else claims.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';

import { drainOn } from '../src/drain.js';

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });

const until = async (check, ms = 2000) => {
  const from = Date.now();
  while (!check()) {
    if (Date.now() - from > ms) throw new Error('the condition never held');
    await new Promise((tick) => setTimeout(tick, 10));
  }
};

test('a request in flight finishes, and the exit is clean', async () => {
  // "In flight" is the server having seen the request, not a sleep: under a
  // loaded suite a sleep can pass before the connection lands, and the drain
  // would close a listener nothing had reached yet.
  let seen;
  const arrived = new Promise((resolve) => (seen = resolve));
  const { server, port } = await listen((req, res) => {
    seen();
    setTimeout(() => res.end('done'), 50);
  });

  let exited = null;
  const drain = drainOn(server, { signals: [], sweep: 10, exit: (code) => (exited = code) });

  const answer = fetch(`http://localhost:${port}/`);
  await arrived;
  drain();

  assert.equal(await (await answer).text(), 'done', 'the drain cut a request in flight');
  await until(() => exited !== null);
  assert.equal(exited, 0, 'the drain did not end cleanly');
});

test('a new connection is refused once the drain begins', async () => {
  const { server, port } = await listen((req, res) => res.end('ok'));

  let exited = null;
  const drain = drainOn(server, { signals: [], sweep: 10, exit: (code) => (exited = code) });
  drain();
  await until(() => exited === 0);

  await assert.rejects(fetch(`http://localhost:${port}/`));
});

test('a render that hangs is cut at the cap, and the exit says so', async () => {
  let seen;
  const arrived = new Promise((resolve) => (seen = resolve));
  const { server, port } = await listen(() => {
    // Never answers. This is the render the cap exists for.
    seen();
  });

  let exited = null;
  const drain = drainOn(server, {
    signals: [],
    sweep: 10,
    grace: 80,
    exit: (code) => (exited = code),
  });

  const doomed = fetch(`http://localhost:${port}/`).catch(() => 'cut');
  await arrived;
  drain();

  await until(() => exited !== null);
  assert.equal(exited, 1, 'a hung render read as a clean drain');
  assert.equal(await doomed, 'cut');
});

test('a stop signal starts the drain', async () => {
  const { server } = await listen((req, res) => res.end('ok'));

  let exited = null;
  drainOn(server, { signals: ['SIGUSR2'], sweep: 10, exit: (code) => (exited = code) });
  process.emit('SIGUSR2');

  await until(() => exited === 0);
});

test('the Node adapter wires it, so a container stop is clean', () => {
  // The same shape as the includeContext test: the wiring lives in a file no
  // test imports, so the file is read for the call.
  const source = fs.readFileSync(new URL('../bin/serve.js', import.meta.url), 'utf8');
  assert.match(source, /drainOn\(/, 'bin/serve.js never calls drainOn');
});
