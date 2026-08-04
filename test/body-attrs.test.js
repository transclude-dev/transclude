// Attributes on `<body>`, written as `<body>`.
//
// `<html>` has worked this way for a while and `<body>` did not: writing
// `<body class="admin">` in a page produced no attribute and no error, because
// the fragment parser drops the tag exactly as it drops `<html>`. Nothing said
// so, which is the reason this file exists.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileLayout, compilePage, splitBlocks } from '../src/compiler/index.js';
import { renderDocument } from '../src/document.js';

const attrsOf = (source, filename = 'p') =>
  compilePage(source, { runtime: '/rt.js', filename }).code.match(
    /export function renderBodyAttrs\(__d\) \{\n  return (.*);\n\}/,
  )[1];

const levelOf = (renderBodyAttrs, over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  renderHtmlAttrs: () => ({}),
  renderBodyAttrs,
  elements: [],
  regions: {},
  render: () => ({ default: '<p>x</p>' }),
  ...over,
});

const bodyTag = (html) => html.match(/<body[^>]*>/)[0];

test('the fragment parser drops <body>, so it is read in document mode', () => {
  const blocks = splitBlocks('<body class="admin">\n<p>x</p>');

  assert.ok(blocks.body, 'the second parse found it');
  assert.deepEqual(
    blocks.body.attrs.map((a) => [a.name, a.value]),
    [['class', 'admin']],
  );
  assert.ok(
    !blocks.nodes.some((n) => n.tagName === 'body'),
    'and it is not left in the markup to be emitted twice',
  );
});

test('a static attribute is carried', () => {
  assert.equal(attrsOf('<body class="admin"><p>x</p>'), '{ "class": "admin" }');
});

test('an interpolated one reads the loader data', () => {
  assert.equal(
    attrsOf('<script server>export default async () => ({ t: "dark" });</script><body data-theme="${t}"><p>x</p>'),
    '{ "data-theme": __d["t"] }',
  );
});

test('a page with no <body> emits an empty object rather than nothing', () => {
  assert.equal(attrsOf('<p>x</p>'), '{}');
});

test('a layout can write them too', () => {
  const { code } = compileLayout('<body class="site"><slot></slot>', {
    id: 'root',
    runtime: '/rt.js',
  });

  assert.match(code, /export function renderBodyAttrs/);
  assert.match(code, /"class": "site"/);
});

// ---- what reaches the document --------------------------------------------

test('the tag is written with the attributes on it', () => {
  const html = renderDocument([levelOf(() => ({ class: 'notes' }))], [{}], {});

  assert.equal(bodyTag(html), '<body class="notes">');
});

test('with none, the tag is still a plain <body>', () => {
  const html = renderDocument([levelOf(() => ({}))], [{}], {});

  assert.equal(bodyTag(html), '<body>');
});

test('a module with no renderBodyAttrs still renders', () => {
  // Every compiled module has one now. A hand-written level, or one compiled
  // before this existed, must not take the page down.
  const html = renderDocument([levelOf(undefined)], [{}], {});

  assert.equal(bodyTag(html), '<body>');
});

test('the chain merges by name, innermost winning per attribute', () => {
  // The same rule `<html>` follows. A root layout setting the theme and a page
  // setting the class must both survive, and two `class` attributes in one tag
  // would leave the parser taking the first, which is the outermost.
  const chain = [
    levelOf(() => ({ 'data-theme': 'dark', class: 'site' })),
    levelOf(() => ({ class: 'notes' })),
  ];
  const tag = bodyTag(renderDocument(chain, [{}, {}], {}));

  assert.match(tag, /data-theme="dark"/, 'the outer one survives');
  assert.match(tag, /class="notes"/, 'and the inner one wins where they meet');
  assert.equal(tag.match(/class=/g).length, 1, 'one class attribute, not two');
});

test('false, null and undefined drop the attribute', () => {
  const html = renderDocument(
    [levelOf(() => ({ hidden: false, a: null, b: undefined, keep: 'yes' }))],
    [{}],
    {},
  );

  assert.equal(bodyTag(html), '<body keep="yes">');
});

test('true writes the name on its own', () => {
  const html = renderDocument([levelOf(() => ({ inert: true }))], [{}], {});

  assert.equal(bodyTag(html), '<body inert>');
});

test('a value is escaped, because it can come from a cookie', () => {
  const html = renderDocument([levelOf(() => ({ 'data-x': '" onload="alert(1)' }))], [{}], {});

  assert.ok(!bodyTag(html).includes('onload="alert'));
  assert.match(bodyTag(html), /&quot;/);
});

test('a name that is not an attribute name is refused, and says which tag', () => {
  assert.throws(
    () => renderDocument([levelOf(() => ({ 'not a name': 'x' }))], [{}], {}),
    /cannot be an attribute on <body>/,
  );
});

test('an interpolated attribute name is refused here too', () => {
  // `<body>` never reaches emitElement, so it needs the check of its own that
  // `<html>` has.
  assert.throws(
    () => compilePage('<body ${name}="x"><p>y</p>', { runtime: '/rt.js' }),
    /interpolates an attribute name/,
  );
});
