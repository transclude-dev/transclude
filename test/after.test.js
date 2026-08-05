// `ctx.after`: work that outlives the response.
//
// The two runtimes this has to be right on behave in opposite ways. workerd
// stops the isolate once the response is sent unless something asked it not to.
// Node keeps going regardless, and ends the process on an unhandled rejection.
// So one of them needs `waitUntil` and the other needs the `catch`, and a test
// that only covers one of those passes on both while being wrong on one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { afterFor, executionCtxOf } from '../src/after.js';
import { createApp } from '../src/app.js';

/** A Hono context on workerd: it has an ExecutionContext. */
function worker() {
  const held = [];
  return { held, executionCtx: { waitUntil: (work) => held.push(work) } };
}

/**
 * A Hono context anywhere else. The getter throws rather than answering
 * undefined, which is the whole reason `executionCtxOf` exists.
 */
function node() {
  return {
    get executionCtx() {
      throw new Error('This context has no ExecutionContext');
    },
  };
}

// ---- asking the runtime ---------------------------------------------------

test('a context with no ExecutionContext answers null instead of throwing', () => {
  assert.equal(executionCtxOf(node()), null);
});

test('a worker context answers the thing with waitUntil on it', () => {
  const c = worker();
  assert.equal(executionCtxOf(c), c.executionCtx);
});

test('a waitUntil that throws is not swallowed', () => {
  // The `try` in `executionCtxOf` covers the getter. Widening it to the call
  // would hide a real failure, and this is what says so.
  const c = {
    executionCtx: {
      waitUntil: () => {
        throw new Error('too late');
      },
    },
  };

  assert.throws(() => afterFor(c, () => {})(Promise.resolve()), /too late/);
});

// ---- holding the isolate open ---------------------------------------------

test('on a worker the work is handed to waitUntil', () => {
  const c = worker();
  afterFor(c, () => {})(Promise.resolve('done'));

  assert.equal(c.held.length, 1);
  assert.equal(typeof c.held[0].then, 'function');
});

test('off a worker nothing is held, and the work still runs', async () => {
  let ran = false;
  const work = Promise.resolve().then(() => (ran = true));

  afterFor(node(), () => {})(work);
  await work;

  assert.equal(ran, true);
});

// ---- the rejection --------------------------------------------------------

test('a rejection is reported rather than left unhandled', async () => {
  const reported = [];
  const boom = new Error('the log server said no');

  afterFor(node(), (error) => reported.push(error))(Promise.reject(boom));
  // A microtask is all it takes. Awaiting the rejected promise here would fail
  // the test with the error it is meant to be catching.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(reported, [boom]);
});

test('what waitUntil is given never rejects, so a worker logs one failure', async () => {
  // The caught promise is the one handed over, not the original. Passing the
  // original would report the error here and again in the platform's own log.
  const c = worker();
  afterFor(c, () => {})(Promise.reject(new Error('no')));

  await assert.doesNotReject(c.held[0]);
});

test('a reporter that throws does not become the failure', async () => {
  // `report` in app.js already guards `onError`. This covers the default one,
  // which is `console.error` and can fail on a closed stream.
  const c = worker();
  afterFor(c, () => {
    throw new Error('the reporter itself');
  })(Promise.reject(new Error('the work')));

  await assert.rejects(c.held[0], /the reporter itself/);
});

// ---- the mistake worth naming ---------------------------------------------

test('a function is refused, because wrapping one would do nothing', () => {
  // `Promise.resolve(() => {})` resolves to the function. The work never runs,
  // nothing throws, and the page renders. This is the one shape with no symptom.
  assert.throws(() => afterFor(node(), () => {})(() => Promise.resolve()), {
    name: 'TypeError',
    message: /takes a promise/,
  });
});

test('undefined is refused too, which is what a non-async function returns', () => {
  assert.throws(() => afterFor(node(), () => {})(undefined), /takes a promise/);
});

test('a thenable is accepted, since that is what an await takes', async () => {
  const c = worker();
  let ran = false;
  const thenable = { then: (resolve) => ((ran = true), resolve('ok')) };

  afterFor(c, () => {})(thenable);
  await c.held[0];

  assert.equal(ran, true);
});

// ---- wired into a real app ------------------------------------------------
//
// Everything above tests the module. These test the seam in `app.js`, which is
// where the argument order and the reporter are decided, and where a mistake
// would leave every test above passing.

const bytes = (text) => new TextEncoder().encode(text);

const pageOf = (load) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  regions: { list: () => '' },
  load,
  render: () => ({ default: '<p>ok</p>' }),
});

const appWith = (load, over = {}) =>
  createApp({
    config: { csrf: false, trailingSlash: 'never', fragmentParam: 'fragment', ...over },
    manifest: { routes: [{ id: 'index', pattern: '/', params: [], client: null }], dynamic: [], endpoints: [] },
    pages: { index: pageOf(load) },
    statics: { get: () => null },
    assets: { get: () => null },
    errorPage: { body: bytes('<p>broke</p>'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (body) => `"${body.length.toString(36)}"`,
    compress: null,
  });

test('a loader is handed after, and the work runs', async () => {
  let ran = null;
  const app = appWith(async ({ after }) => {
    after(Promise.resolve().then(() => (ran = 'yes')));
    return {};
  });

  const out = await app.request('http://x/');
  assert.equal(out.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ran, 'yes');
});

test('the response does not wait for it', async () => {
  // The point of the whole thing. A slow log must not hold the reader.
  let done = false;
  const slow = new Promise((resolve) => setTimeout(resolve, 50)).then(() => (done = true));
  const app = appWith(async ({ after }) => (after(slow), {}));

  await app.request('http://x/');
  assert.equal(done, false, 'the render waited for work it was told not to wait for');
  await slow;
});

test('work that fails reaches onError with the request that started it', async () => {
  const seen = [];
  const app = appWith(async ({ after }) => (after(Promise.reject(new Error('log refused'))), {}), {
    onError: (error, about) => seen.push([error.message, about.url, about.method]),
  });

  const out = await app.request('http://x/');
  assert.equal(out.status, 200, 'a failure after the response must not change it');

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [['log refused', 'http://x/', 'GET']]);
});

test('an ExecutionContext is used when the runtime hands one over', async () => {
  // What workerd does. Hono takes it as the fourth argument to `request`, the
  // same way `worker.js` passes it through to `fetch`.
  const held = [];
  const app = appWith(async ({ after }) => (after(Promise.resolve()), {}));

  await app.request('http://x/', {}, {}, { waitUntil: (work) => held.push(work), passThroughOnException() {} });
  assert.equal(held.length, 1);
});
