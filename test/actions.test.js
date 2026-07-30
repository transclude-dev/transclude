// A page answers more than GET.
//
// `<form method="post">` is the oldest way to change state on the web, and the
// reason an app can work with no client JavaScript. The action does the work.
// `load` still decides what the page renders, whatever method asked.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_METHODS,
  hasRegion,
  methodsOf,
  renderFragment,
  renderRoute,
  runAction,
} from '../src/document.js';
import { buildShim } from '../src/compiler/shim.js';

const CTX = '{ url: string; params: {}; layout: {}; request: Request | null; action: unknown }';
const shimOf = (server) =>
  buildShim(`<script server>\n${server}\n</script>\n<p>x</p>`, {
    kind: 'page',
    contextType: CTX,
  }).code;

const pageOf = (over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  load: async (ctx) => ({ action: ctx.action }),
  render: (d) => ({ default: `<body action=${JSON.stringify(d.action)}>` }),
  regions: { list: (d) => `<list action=${JSON.stringify(d.action)}>` },
  ...over,
});

// ---- runAction ------------------------------------------------------------

test('a page that does not answer the method says so, rather than nothing', async () => {
  assert.equal(await runAction(pageOf(), {}, 'POST'), null);
});

test('null is 405, not 404, because the URL exists and the method does not', () => {
  // The distinction only matters because something has to choose the status,
  // and both servers choose it from this.
  assert.deepEqual(methodsOf(pageOf()), ['GET']);
  assert.deepEqual(methodsOf(pageOf({ actions: { post: () => {}, delete: () => {} } })), [
    'GET',
    'POST',
    'DELETE',
  ]);
});

test('the method is matched case-insensitively, because HTTP sends it upper', async () => {
  const page = pageOf({ actions: { post: async () => ({ ok: true }) } });
  assert.deepEqual(await runAction(page, {}, 'POST'), { action: { ok: true } });
});

test('what an action returns becomes ctx.action', async () => {
  const page = pageOf({ actions: { post: async () => ({ added: 'a note' }) } });
  const { action } = await runAction(page, {}, 'POST');
  assert.deepEqual(action, { added: 'a note' });
});

test('an action that returns nothing still ran', async () => {
  const page = pageOf({ actions: { post: async () => {} } });
  assert.deepEqual(await runAction(page, {}, 'POST'), { action: {} });
});

test('a Response is the answer itself, and nothing renders', async () => {
  // Redirect-after-post, JSON, a 404 the page chose. The platform already has a
  // type for "this is the reply", so there is no framework one to learn.
  const redirect = new Response(null, { status: 303, headers: { Location: '/notes' } });
  const page = pageOf({ actions: { post: async () => redirect } });

  const outcome = await runAction(page, {}, 'POST');
  assert.equal(outcome.response, redirect);
  assert.equal(outcome.action, undefined, 'a Response short-circuits, so there is nothing to render from');
});

test('the action is handed the same ctx the loader gets', async () => {
  let saw = null;
  const page = pageOf({ actions: { post: async (ctx) => ((saw = ctx), {}) } });
  const ctx = { url: 'http://x/notes', request: new Request('http://x/notes', { method: 'POST' }) };

  await runAction(page, ctx, 'POST');
  assert.equal(saw, ctx);
});

test('an action can read a form off the platform Request', async () => {
  // No router API in the way: this is what `await request.formData()` is.
  const body = new URLSearchParams({ text: 'a note' });
  const request = new Request('http://x/notes', { method: 'POST', body });
  const page = pageOf({
    actions: {
      post: async ({ request }) => ({ text: (await request.formData()).get('text') }),
    },
  });

  const { action } = await runAction(page, { request }, 'POST');
  assert.deepEqual(action, { text: 'a note' });
});

test('a throwing action throws, so a server answers 500 rather than a half page', async () => {
  const page = pageOf({ actions: { post: async () => { throw new Error('nope'); } } });
  await assert.rejects(() => runAction(page, {}, 'POST'), /nope/);
});

test('every method a form or a fetch caller can send is routed', () => {
  assert.deepEqual(ACTION_METHODS, ['POST', 'PUT', 'PATCH', 'DELETE']);
  assert.ok(!ACTION_METHODS.includes('GET'), 'GET renders, it does not act');
});

// ---- what renders afterwards ---------------------------------------------

test('after an action the page renders exactly as it does for a GET', async () => {
  const html = await renderRoute(pageOf(), { action: { added: 'x' } });
  assert.match(html, /<body action=\{"added":"x"\}>/);
});

test('after an action one region can render on its own', async () => {
  // POST the form, get back the list. Same action, same loader, same compiled
  // region the document uses. A fragment is a smaller answer, not another path.
  const html = await renderFragment(pageOf(), { action: { added: 'x' } }, { region: 'list' });
  assert.equal(html, '<list action={"added":"x"}>');
});

// ---- what the typechecker sees -------------------------------------------

test("an action's ctx is the route context, with request no longer nullable", () => {
  // Null only while prerendering, and prerendering never runs an action. An
  // author should not have to answer a question that cannot come up.
  const code = shimOf('export const actions = { async post({ request }) { return {}; } };');
  assert.match(code, /@satisfies \{Record<string, \(ctx: .* & \{ request: Request \}\) => unknown>\}/);
});

test("the loader's ctx.action is the union of what this page's actions return", () => {
  const code = shimOf('export const actions = { post: async () => ({ ok: true }) };\nexport default async () => ({});');
  assert.match(code, /action: Exclude<Awaited<ReturnType<\(typeof actions\)\[keyof typeof actions\]>>, Response> \| null/);
});

test('a page with no actions has no action to read', () => {
  const code = shimOf('export default async () => ({});');
  assert.match(code, /\{ action: null \| null \}/);
  assert.doesNotMatch(code, /typeof actions/);
});

test('a server block with only actions and no loader still gets checked', () => {
  // No default export used to mean the block was copied and nothing annotated,
  // so an action's ctx went untyped in exactly the page most likely to have one.
  const code = shimOf('export const actions = { async post({ request }) { return {}; } };');
  assert.match(code, /@satisfies \{Record<string,/);
  assert.match(code, /@typedef \{\{\}\} __Data/, 'it renders from nothing, so its data shape is empty');
});

// ---- a request nobody can answer ------------------------------------------

test('a region name that does not exist is knowable before the action runs', () => {
  const page = pageOf({ regions: { list: () => '' } });
  assert.equal(hasRegion(page, 'list'), true);
  assert.equal(hasRegion(page, 'nope'), false);
});

test('no region named is the page body, which always exists', () => {
  assert.equal(hasRegion(pageOf({ regions: {} }), ''), true);
  assert.equal(hasRegion(pageOf({ regions: {} }), null), true);
});

test('a page with no regions at all can still be asked for its body', () => {
  assert.equal(hasRegion({}, ''), true);
  assert.equal(hasRegion({}, 'list'), false);
});
