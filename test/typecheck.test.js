import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildShim, originalOffset } from '../src/compiler/shim.js';
import { GLOBALS as EXPRESSION_GLOBALS } from '../src/compiler/expr.js';
import { createChecker, positionAt } from '../src/typecheck.js';

const CONTEXT = '{ params: { name: string }; layout: { site: string } }';

const shim = (source, options = {}) =>
  buildShim(source, { kind: 'page', contextType: CONTEXT, ...options });

// ---- the shim --------------------------------------------------------------

test('a shim is a module, so its types cannot leak into another file', () => {
  // Without an import or export, TypeScript treats a file as a global script and
  // every shim's __Data collides in one shared scope.
  assert.match(shim('<p>x</p>').code, /^export \{\};/m);
});

test('data identifiers are prefixed, loop variables are not', () => {
  const { code } = shim('<li each="p of people">${p.name} ${heading}</li>');
  assert.match(code, /for \(const p of __d\.people\)/);
  assert.match(code, /__expr\(p\.name\)/);
  assert.match(code, /__expr\(__d\.heading\)/);
});

test('runtime globals are parameters, so an import of the same name cannot clash', () => {
  const { code } = shim('<p>${html(body)}</p>');
  assert.match(code, /@param \{\(value: unknown\) => string\} html/);
  assert.match(code, /__expr\(html\(__d\.body\)\)/);
});

test('json is a global here too, not a field of the page data', () => {
  // It was declared as a parameter of `__template` and still rewritten to
  // `__d.json`, so `${json(rows)}` compiled, rendered, and then failed
  // `npm run check` saying json was not on the data. Reported from an app.
  const { code } = shim('<script type="application/json">${json(rows)}</script><p>x</p>');

  assert.match(code, /__expr\(json\(__d\.rows\)\)/);
  assert.doesNotMatch(code, /__d\.json/);
});

test('every name the compiler resolves without a lookup resolves here', () => {
  // The two lists were written out separately and drifted. This is the check
  // that says they agree, without either of them having to be exported: a name
  // the expression layer treats as a global must not come out as page data.
  for (const name of EXPRESSION_GLOBALS) {
    const { code } = shim(`<p>\${${name}}</p>`);

    assert.doesNotMatch(code, new RegExp(`__d\\.${name}\\b`), `${name} was read off the data`);
  }
});

test('the loader keeps its inferred return type while its parameter is typed', () => {
  const { code } = shim(
    `<script server>export default ({ params }) => ({ a: params.x });</script><p>\${a}</p>`,
  );
  // The context is inlined rather than imported: transclude-env.d.ts is generated *from*
  // these shims, so it cannot also be an input to them.
  assert.match(code, /@satisfies \{\(ctx: \{ params: \{ name: string \}/);
  assert.match(
    code,
    /@typedef \{__Shape<Exclude<Awaited<ReturnType<typeof __default>>, Response>>\} __Data/,
  );
});

test('imports and named exports of a block stay put', () => {
  const { code } = shim(
    `<script server>
import { db } from './db.js';
export const paths = () => [];
export default () => ({ a: 1 });
</script><p>x</p>`,
  );
  assert.match(code, /import \{ db \} from '\.\/db\.js';/);
  assert.match(code, /export const paths = \(\) => \[\];/);
});

test('the element block is copied as a module, not rebuilt as an expression', () => {
  const { code } = shim(`<script element>
  export const properties = { a: 1 };
</script><p>\${a}</p>`, {
    kind: 'component',
    contextType: null,
  });
  assert.match(code, /const __props = \{ a: 1 \}/);
  assert.match(code, /@typedef \{__Shape<typeof __props>\} __Props/);
  assert.match(code, /@typedef \{__Props & __State\} __Data/);
});

test('JSDoc in a props block survives into the shim', () => {
  // The reason shims are .js: a JSDoc @type is ignored in a .ts file.
  const { code } = shim(
    `<script element>
  export const properties = { /** @type {string[]} */ tags: [] };
</script><p>x</p>`,
    { kind: 'component', contextType: null },
  );
  assert.match(code, /@type \{string\[\]\}/);
});

test('an empty shape is {}, not an index signature', () => {
  // Record<string, never> reads as "no properties", but it carries an index
  // signature: intersecting with one makes every misspelling legal, which
  // silently disabled the check this whole file exists for.
  const { code } = shim('<p>x</p>', { kind: 'component', contextType: null });
  assert.doesNotMatch(code, /Record<string, never>/);
  assert.match(code, /@typedef \{\{\}\} __State/);
});

test('a syntax error in a block does not produce a broken shim', () => {
  const { code } = shim(`<script server>export default ( => ;</script><p>x</p>`);
  assert.match(code, /@typedef \{\{\}\} __Data/);
});

// ---- source mapping --------------------------------------------------------

test('offsets map back to the exact token in the .html file', () => {
  const source = '<p>${heading}</p>';
  const { code, chunks } = shim(source);

  const inShim = code.indexOf('heading', code.indexOf('__expr'));
  assert.equal(originalOffset(chunks, inShim), source.indexOf('heading'));
});

test('generated scaffolding maps to nothing, so it can be discarded', () => {
  const { code, chunks } = shim('<p>${heading}</p>');
  assert.equal(originalOffset(chunks, code.indexOf('export {}')), null);
});

test('a component prop key is mapped, or its type error would be dropped', () => {
  const source = '<user-card name="${who}"></user-card>';
  const { code, chunks } = shim(source, {
    componentProps: new Map([['user-card', '{ name: string }']]),
  });
  const key = code.indexOf('name:', code.indexOf('__props_user_card'));
  assert.equal(originalOffset(chunks, key), source.indexOf('name='));
});

// ---- checking a real project ----------------------------------------------

function project(files, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-check-'));
  fs.mkdirSync(path.join(dir, 'app/routes'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'app/transclude-env.d.ts'),
    `export {};
export interface IndexContext { params: Record<string, string>; layout: { site: string }; }
export interface UserCardProps { name: string; tags: string[] }
`,
  );
  return { dir, checker: createChecker({ root: dir, ...options }) };
}

test('a typo against loader data is an error at the right place', () => {
  const source = `<script server>export default () => ({ heading: 'x' });</script>
<h1>\${headng}</h1>`;
  const { dir, checker } = project({ 'app/routes/index.html': source });

  const [diagnostic] = checker.check(path.join(dir, 'app/routes/index.html'));
  assert.match(diagnostic.message, /'headng' does not exist/);
  assert.equal(positionAt(source, diagnostic.offset).line, 2);
  assert.equal(source.slice(diagnostic.offset, diagnostic.offset + 6), 'headng');
});

test('a typo against route context is caught inside the loader', () => {
  const { dir, checker } = project({
    'app/routes/index.html': `<script server>export default ({ layout }) => ({ a: layout.sight });</script><p>x</p>`,
  });
  const [diagnostic] = checker.check(path.join(dir, 'app/routes/index.html'));
  assert.match(diagnostic.message, /'sight' does not exist/);
});

test('a misspelled built-in method is caught, with a suggestion', () => {
  const { dir, checker } = project({
    'app/routes/index.html': `<script server>export default () => ({ t: 'x' });</script><p>\${t.toUpperCse()}</p>`,
  });
  const [diagnostic] = checker.check(path.join(dir, 'app/routes/index.html'));
  assert.match(diagnostic.message, /toUpperCse.*Did you mean 'toUpperCase'/s);
});

test('correct files produce nothing', () => {
  const { dir, checker } = project({
    'app/routes/index.html': `<script server>export default () => ({ items: ['a'] });</script>
<li each="i of items">\${i.toUpperCase()}</li>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/routes/index.html')), []);
});

test('an editor buffer is checked without touching disk', () => {
  const clean = `<script server>export default () => ({ a: 1 });</script><p>\${a}</p>`;
  const { dir, checker } = project({ 'app/routes/index.html': clean });
  const file = path.join(dir, 'app/routes/index.html');

  assert.deepEqual(checker.check(file), []);

  checker.update(file, clean.replace('${a}', '${b}'));
  assert.match(checker.check(file)[0].message, /'b' does not exist/);
  assert.equal(fs.readFileSync(file, 'utf8'), clean, 'the file on disk was not modified');
});

test('hover reports the type of an expression in the template', () => {
  const source = `<script server>export default () => ({ count: 2 });</script><p>\${count}</p>`;
  const { dir, checker } = project({ 'app/routes/index.html': source });

  const info = checker.quickInfo(path.join(dir, 'app/routes/index.html'), source.indexOf('count}'));
  assert.match(info.text, /count: number/);
});

// ---- what the author writes survives ---------------------------------------

test('a JSDoc typedef and a whole-object @type both reach tsc', () => {
  // Neither is a statement, so copying the block statement-by-statement would
  // drop them without a word, and they are how an author says what `[]` holds.
  const { code } = shim(
    `<script element>
  /** @typedef {{ columns: string[] }} Props */
  /** @type {Props} */
  export const properties = { columns: [] };
</script><th each="c of columns">\${c}</th>`,
    { kind: 'component', contextType: null },
  );
  assert.match(code, /@typedef \{\{ columns: string\[\] \}\} Props/);
  assert.match(code, /@type \{Props\} \*\/\s*const __props/, 'the annotation lost its value');
});

test('an empty array without an annotation is usable, not never[]', () => {
  // Annotations are optional. A bare [] used to infer never[], which turned
  // "no annotation" from less checking into a page of errors about a type
  // nobody wrote.
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script element>
  export const properties = { columns: [] };
</script>
<th each="c of columns">\${c.length}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('an unannotated parameter is plain JavaScript, not an error', () => {
  // JSDoc is optional. A parameter with no declared type is `any`, the same as it
  // would be in any other .js file.
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script element>
  export const properties = { columns: [] };

  export const prototype = {
    add(column) { this.columns = [...this.columns, column]; },

    connected({ signal }) {
      this.addEventListener('click', (event) => void event, { signal });
    },
  };
</script>
<th each="c of columns">\${c}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('a helper the prototype reads is resolvable in the shim', () => {
  // The helper is hoisted with the members in the generated module, so the shim
  // has to copy it too, or tsc reports a name the browser resolves fine.
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script element>
  export const properties = { columns: [] };

  const LIMIT = 3;

  export const prototype = {
    /** @returns {number} */
        get shown() { return Math.min(this.columns.length, LIMIT); },

    connected({ signal }) {
      this.addEventListener('click', () => void 0, { signal });
    },
  };
</script>
<th>\${columns.length}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('connected() is checked like everything else in the block', () => {
  // It used to be a `<script>` body running with four names nobody declared, so
  // tsc was told nothing about it and checked none of it. As a member of a
  // module it is ordinary code, and `this` is the element.
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script element>
  export const properties = { columns: [] };

  export const prototype = {
    connected({ signal }) {
      this.addEventListener('click', () => void this.columns.length, { signal });
    },
  };
</script>
<th>\${columns.length}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('a typo inside connected() is now reported, where it used to be invisible', () => {
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script element>
  export const properties = { columns: [] };

  export const prototype = {
    connected() {
      void this.colums.length;
    },
  };
</script>
<th>\${columns.length}</th>`,
  });
  const [first] = checker.check(path.join(dir, 'app/elements/data-table.html'));
  assert.match(first.message, /colums/);
});

test('strict: true puts the annotations back on the critical path', () => {
  const { dir, checker } = project(
    {
      'app/elements/data-table.html': `<script element>
  export const properties = { columns: [] };

  export const prototype = {
    add(column) { void column; }
  };
</script>
<th>x</th>`,
    },
    { strict: true },
  );
  const [diagnostic] = checker.check(path.join(dir, 'app/elements/data-table.html'));
  assert.match(diagnostic.message, /implicitly has an 'any' type/);
});

test('a misspelled prop is still caught with no annotations anywhere', () => {
  // What the mapping buys back: TypeScript would otherwise allow reading an
  // undeclared property off a type that came from an object literal in a .js
  // file, and that is the one check this framework most needs.
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script element>
  export const properties = { columns: [] };
</script>
<th>\${colums.length}</th>`,
  });
  const [diagnostic] = checker.check(path.join(dir, 'app/elements/data-table.html'));
  assert.match(diagnostic.message, /colums/);
});

test('the same file with an annotation checks clean', () => {
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script element>
  /** @type {{ columns: string[] }} */

  export const properties = { columns: [] };
</script><th each="c of columns">\${c.length}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('a dash-case attribute is checked under its camelCase prop name', () => {
  const source = '<data-table empty-label="${label}"></data-table>';
  const { code, chunks } = shim(source, {
    componentProps: new Map([['data-table', '{ emptyLabel: string }']]),
  });

  assert.match(code, /emptyLabel: __d\.label/);
  // still anchored to the attribute in the source, or its diagnostic is dropped
  const key = code.indexOf('emptyLabel:', code.indexOf('__props_data_table'));
  assert.equal(originalOffset(chunks, key), source.indexOf('empty-label'));
});

// ---- attributes that are not props ----------------------------------------
//
// `hx-*` belongs to whichever library the author brought, `data-*`
// and `aria-*` to the platform. None of them are declared in <script
// properties>, so treating an interpolated one as a prop turned a correct page
// into a type error. That is what `hx-get="/notes?id=${id}"` on a component used
// to be.

const withCard = (markup) => ({
  'app/elements/user-card.html': `<script element>
  export const properties = { name: '' };
</script>
<h3>\${name}</h3>`,
  'app/routes/index.html': `<script server>export default () => ({ id: 1 });</script>\n${markup}`,
});

const errorsFor = (markup) => {
  const { dir, checker } = project(withCard(markup));
  return checker.check(path.join(dir, 'app/routes/index.html'));
};

for (const prefix of ['hx-get', 'data-key', 'aria-label']) {
  test(`an interpolated ${prefix} on a component is not a prop`, () => {
    assert.deepEqual(
      errorsFor(`<user-card ${prefix}="/n?id=\${id}" name="x"></user-card>`).map((d) => d.message),
      [],
    );
  });
}

test('the expression inside one is still checked', () => {
  // Not a way out of checking. Only the claim that the name is a declared prop
  // goes away. A typo in the `${…}` is an error the same as anywhere else.
  const [diagnostic] = errorsFor('<user-card hx-get="/n?id=${idd}" name="x"></user-card>');
  assert.match(diagnostic.message, /'idd' does not exist/);
});

test('an undeclared attribute that is not pass-through is still a prop error', () => {
  const [diagnostic] = errorsFor('<user-card nope="${id}" name="x"></user-card>');
  assert.match(diagnostic.message, /'nope' does not exist/);
});

test('a prefix that merely starts the same way is still a prop', () => {
  // `database` is not `data-`.
  const [diagnostic] = errorsFor('<user-card database="${id}" name="x"></user-card>');
  assert.match(diagnostic.message, /'database' does not exist/);
});

// ---- ctx.cookies is checked, not `any` -------------------------------------

const serverErrors = (block) => {
  const { dir, checker } = project({
    'app/routes/index.html': `<script server>${block}</script><p>x</p>`,
  });
  return checker.check(path.join(dir, 'app/routes/index.html'));
};

test('a mistyped cookie method is an error', () => {
  const [diagnostic] = serverErrors(`export default async ({ cookies }) => ({ a: cookies.gett('x') });`);
  assert.match(diagnostic.message, /gett/);
});

test('a mistyped signed cookie method is an error', () => {
  const [diagnostic] = serverErrors(
    `export default async ({ cookies }) => ({ a: await cookies.signed.read('x') });`,
  );
  assert.match(diagnostic.message, /read/);
});

test('a cookie option that does not exist is an error', () => {
  const [diagnostic] = serverErrors(
    `export default async ({ cookies }) => { cookies.set('a', 'b', { htpOnly: true }); return {}; };`,
  );
  assert.match(diagnostic.message, /htpOnly/);
});

test('reading a cookie is a string or undefined, not any', () => {
  // `any` would make `.toUpperCase()` legal on a cookie that was never sent.
  const [diagnostic] = serverErrors(
    `export default async ({ cookies }) => ({ a: cookies.get('x').toUpperCase() });`,
  );
  assert.match(diagnostic.message, /possibly 'undefined'/);
});

test('the correct calls produce nothing', () => {
  assert.deepEqual(
    serverErrors(
      `export default async ({ cookies }) => {
         cookies.set('a', 'b', { httpOnly: false, maxAge: 60, sameSite: 'Strict' });
         cookies.delete('a');
         return { seen: (await cookies.signed.get('s')) ?? 'none', all: cookies.all() };
       };`,
    ).map((d) => d.message),
    [],
  );
});

// ---- endpoints are checked too ----------------------------------------------
//
// A `.js` route was not in the tsc program at all: its `ctx` was an implicit
// `any` and nothing held it to returning a Response.

const endpointErrors = (source) => {
  const { dir, checker } = project({
    'app/routes/index.html': '<p>x</p>',
    'app/routes/api/thing.js': source,
  });
  return checker.check(path.join(dir, 'app/routes/api/thing.js'));
};

test('an endpoint is in the program at all', () => {
  const { dir, checker } = project({
    'app/routes/index.html': '<p>x</p>',
    'app/routes/api/thing.js': 'export const GET = () => new Response("ok");',
  });
  assert.ok(
    checker.files().some((file) => file.endsWith(path.join('api', 'thing.js'))),
    'files() decides what `npm run check` looks at',
  );
});

test("a ctx field that does not exist is an error in a handler", () => {
  const [diagnostic] = endpointErrors('export const GET = ({ nope }) => Response.json(nope);');
  assert.match(diagnostic.message, /'nope' does not exist/);
});

test('a handler that returns nothing is an error', () => {
  // TypeScript reports this at the annotation, which is generated text. With an
  // unmapped position the diagnostic was dropped and this passed quietly.
  const [diagnostic] = endpointErrors('export const GET = () => {};');
  assert.match(diagnostic.message, /not assignable to type 'Promise<Response> \| Response'/);
});

test('a handler that returns a bare object is an error', () => {
  const [diagnostic] = endpointErrors('export const POST = () => ({ ok: true });');
  assert.match(diagnostic.message, /not assignable to type 'Promise<Response> \| Response'/);
});

test('the error points into the real file, not into the shim', () => {
  const source = 'export const GET = () => {};';
  const { dir, checker } = project({
    'app/routes/index.html': '<p>x</p>',
    'app/routes/api/thing.js': source,
  });
  const [diagnostic] = checker.check(path.join(dir, 'app/routes/api/thing.js'));

  assert.ok(diagnostic.offset >= 0 && diagnostic.offset <= source.length, 'offset is off the end');
  assert.equal(source.slice(diagnostic.offset, diagnostic.offset + 6), 'export');
});

test('an export that is not a verb gets no signature', () => {
  // A helper in an endpoint file is just a helper.
  assert.deepEqual(
    endpointErrors(
      'export const shape = (p) => ({ id: p });\nexport const GET = () => Response.json(shape(1));',
    ).map((d) => d.message),
    [],
  );
});

test('an all-caps export that is not a method is a constant, not a handler', () => {
  // The rule was "any all-caps name", so a constant beside a handler was held to
  // `Response | Promise<Response>` and reported as an error about correct code.
  // The test above only ever tried a lowercase helper, which that rule allowed.
  assert.deepEqual(
    endpointErrors(
      'export const LIMIT = 10;\nexport const GET = () => Response.json({ LIMIT });',
    ).map((d) => d.message),
    [],
  );
});

test('an async handler is fine, since a Promise<Response> satisfies it', () => {
  assert.deepEqual(
    endpointErrors('export const GET = async () => Response.json({});').map((d) => d.message),
    [],
  );
});

test('export function GET counts as much as export const GET', () => {
  const [diagnostic] = endpointErrors('export function GET() { return { no: 1 }; }');
  assert.match(diagnostic.message, /not assignable to type 'Promise<Response> \| Response'/);
});

test("an endpoint's ctx has no layout, because nothing renders", () => {
  const [diagnostic] = endpointErrors('export const GET = ({ layout }) => Response.json(layout);');
  assert.match(diagnostic.message, /'layout' does not exist/);
});

test("an endpoint's request is never null, because prerendering never runs one", () => {
  assert.deepEqual(
    endpointErrors(
      'export const POST = async ({ request }) => Response.json(await request.json());',
    ).map((d) => d.message),
    [],
  );
});

test('a loader that can answer with a Response still types its own template', () => {
  // A layout guarding a section returns `Response.redirect(...)`, which is the
  // documented way to write one. Its own markup only renders on the other
  // branch, so the data a template reads is the return with Response taken out.
  // Without that, every name in the layout's markup was an error about a union
  // it can never be handed. `ctx.action` has excluded Response all along.
  const { code } = shim(
    `<script server>export default ({ url }) =>
       url ? Response.redirect('/login', 303) : ({ user: 'ada' });</script><p>\${user}</p>`,
  );

  assert.match(code, /Exclude<Awaited<ReturnType<typeof __default>>, Response>/);
});

test('the unstable API is checked by shape, and the refusal names what moved', async () => {
  // The port stands on `typescript/unstable/sync`, whose name is its own
  // warning. A moved subpath fails loudly with the wrong name; a renamed flag
  // does not fail at all, because an undefined bit ORs into the format flags
  // as nothing and types print wrong without a word. Both roads lead here.
  const { refuseMovedAPI } = await import('../src/typecheck.js');
  const real = await import('typescript/unstable/sync');

  // The shape that holds today passes through untouched.
  assert.equal(refuseMovedAPI(real, '7.0.2'), real);

  // The subpath gone entirely: three names, and no flag noise behind them.
  assert.throws(
    () => refuseMovedAPI(null, '7.1.0'),
    /API, DiagnosticCategory, NodeBuilderFlags are gone.*typescript@7\.0\.2/s,
  );

  // One renamed flag, which is the quiet failure this exists for.
  const renamed = { ...real, NodeBuilderFlags: { ...real.NodeBuilderFlags, InTypeAlias: undefined } };
  assert.throws(
    () => refuseMovedAPI(renamed, '7.1.0'),
    /NodeBuilderFlags\.InTypeAlias is gone.*typescript@7\.0\.2/s,
  );
});

// ---- describe(), which is what transclude-env.d.ts is written from ---------
//
// `types.test.js` covers the emitter and passes it shapes by hand. This is the
// half that produces them: a real language service over a real app, so the
// types are the ones tsc inferred rather than the ones a test made up.

/** Everything `describe()` found, keyed by id, so an assertion can name one. */
const by = (list, key = 'id') => Object.fromEntries(list.map((one) => [one[key], one]));

test('a page describes its data, its context and its route params', () => {
  const { checker } = project({
    'app/routes/blog/[slug].html':
      "<script server>export default ({ params }) => ({ slug: params.slug, hits: 2 });</script><p>${slug}</p>",
  });

  const page = by(checker.describe().pages)['blog-_slug'];

  assert.deepEqual(page.params, ['slug']);
  assert.equal(page.pattern, '/blog/:slug');
  assert.match(page.type, /slug: string/);
  assert.match(page.type, /hits: number/);
});

test('a page with no loader still describes, with no data', () => {
  // A page that reads nothing needs no block, and the emitted file still has to
  // name a type for it. Leaving it out would give the page's own shim nothing
  // to check against.
  const { checker } = project({ 'app/routes/index.html': '<h1>Home</h1>' });

  const page = by(checker.describe().pages).index;

  assert.ok(page, 'the page was left out entirely');
  assert.deepEqual(page.params, []);
});

test('a layout describes its own data', () => {
  const { checker } = project({
    'app/routes/_layout.html': "<script server>export default () => ({ site: 'x' });</script><slot></slot>",
    'app/routes/index.html': '<h1>Home</h1>',
  });

  const layout = by(checker.describe().layouts).root;

  assert.match(layout.type, /site: string/);
});

test('a light element is a partial and a shadow one is a component', () => {
  // They are described apart because nothing about a shadow root applies to a
  // light element, and the emitted file gives each a different tag name map
  // entry.
  const { checker } = project({
    'app/routes/index.html': '<h1>Home</h1>',
    'app/elements/plain-note.html':
      "<p>${text}</p><script element>export const properties = { text: '' };</script>",
    'app/elements/boxed-card.html':
      '<article><slot></slot></article><script element>export const shadow = true;\nexport const properties = { open: false };</script>',
  });

  const described = checker.describe();

  assert.deepEqual(
    described.partials.map((one) => one.tag),
    ['plain-note'],
  );
  assert.deepEqual(
    described.components.map((one) => one.tag),
    ['boxed-card'],
  );
});

// ---- names the app declared ------------------------------------------------

test('a type the app declared is carried by value, not by name', () => {
  // A `@typedef` is reachable from the file it was written in and nowhere else,
  // and one written in an .html file has no module to be imported from. So the
  // emitted file needs the shape, and `describe` is what expands it.
  const { checker } = project({
    'app/data/posts.js':
      '/** @typedef {{ title: string, draft: boolean }} Post */\n/** @type {Post[]} */\nexport const posts = [];\n',
    'app/routes/index.html':
      "<script server>import { posts } from '../data/posts.js';\nexport default () => ({ posts });</script><p>x</p>",
  });

  const described = checker.describe();
  const post = by(described.types, 'name').Post;

  assert.ok(post, `Post was never expanded: ${described.types.map((t) => t.name).join(', ')}`);
  assert.match(post.type, /title: string/);
  assert.match(post.type, /draft: boolean/);
  // The page names it rather than repeating the shape, which is the whole point
  // of expanding it once.
  assert.match(by(described.pages).index.type, /Post/);
});

test('two files each declaring a Post get two names', () => {
  // One name cannot mean two shapes. The second is renamed rather than
  // overwriting the first, which would give one page the other page's type and
  // still compile.
  const { checker } = project({
    'app/data/posts.js':
      '/** @typedef {{ title: string }} Post */\n/** @type {Post[]} */\nexport const posts = [];\n',
    'app/data/drafts.js':
      '/** @typedef {{ slug: number }} Post */\n/** @type {Post[]} */\nexport const drafts = [];\n',
    'app/routes/index.html':
      "<script server>import { posts } from '../data/posts.js';\nexport default () => ({ posts });</script><p>x</p>",
    'app/routes/drafts.html':
      "<script server>import { drafts } from '../data/drafts.js';\nexport default () => ({ drafts });</script><p>x</p>",
  });

  const types = by(checker.describe().types, 'name');

  assert.ok(types.Post, 'the first Post was never expanded');
  assert.ok(types.Post_2, `the second Post did not get its own name: ${Object.keys(types).join(', ')}`);
  assert.notEqual(types.Post.type, types.Post_2.type);
});

test('a type naming itself terminates', () => {
  // `byKey` is written before the expansion is resolved, so the second visit
  // returns the name already chosen. Take that line out and this test does not
  // fail, it hangs, which is the shape the bug would have had in `npm run
  // check` on any app with a tree in it.
  const { checker } = project({
    'app/data/tree.js':
      '/** @typedef {{ label: string, children: Node[] }} Node */\n/** @type {Node} */\nexport const tree = { label:4 === 4 ? "a" : "b", children: [] };\n',
    'app/routes/index.html':
      "<script server>import { tree } from '../data/tree.js';\nexport default () => ({ tree });</script><p>x</p>",
  });

  const types = by(checker.describe().types, 'name');

  assert.ok(types.Node, 'Node was never expanded');
  assert.match(types.Node.type, /children: Node\[\]/);
});

test('what the compiler declares for itself is left to the emitted file', () => {
  // `__Cookies` and the rest are written from `ambient.js`, so a copy expanded
  // here would sit in the file under a name nothing reads. This pins the
  // outcome; the `AMBIENT_NAMES` guard that produces it has no separate effect
  // to break, because those names are not exported by any file to expand from.
  const { checker } = project({
    'app/routes/index.html':
      '<script server>export default ({ cookies }) => ({ seen: cookies.get("seen") });</script><p>x</p>',
  });

  const described = checker.describe();

  assert.match(by(described.pages).index.context, /__Cookies/);
  assert.deepEqual(
    described.types.filter((one) => one.name.startsWith('__')),
    [],
  );
});
