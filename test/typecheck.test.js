import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildShim, originalOffset } from '../src/compiler/shim.js';
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

test('the loader keeps its inferred return type while its parameter is typed', () => {
  const { code } = shim(
    `<script server>export default ({ params }) => ({ a: params.x });</script><p>\${a}</p>`,
  );
  // The context is inlined rather than imported: transclude-env.d.ts is generated *from*
  // these shims, so it cannot also be an input to them.
  assert.match(code, /@satisfies \{\(ctx: \{ params: \{ name: string \}/);
  assert.match(code, /@typedef \{__Shape<Awaited<ReturnType<typeof __default>>>\} __Data/);
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

test('a props block is a module body too, not an expression', () => {
  const { code } = shim(`<script properties>export default { a: 1 };</script><p>\${a}</p>`, {
    kind: 'component',
    contextType: null,
  });
  assert.match(code, /const __props = \(\{ a: 1 \}\)/);
  assert.match(code, /@typedef \{__Shape<typeof __props>\} __Props/);
  assert.match(code, /@typedef \{__Props & __State\} __Data/);
});

test('JSDoc in a props block survives into the shim', () => {
  // The reason shims are .js: a JSDoc @type is ignored in a .ts file.
  const { code } = shim(
    `<script properties>export default { /** @type {string[]} */ tags: [] };</script><p>x</p>`,
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
    `<script properties>
/** @typedef {{ columns: string[] }} Props */
/** @type {Props} */
export default { columns: [] };
</script><th each="c of columns">\${c}</th>`,
    { kind: 'component', contextType: null },
  );
  assert.match(code, /@typedef \{\{ columns: string\[\] \}\} Props/);
  assert.match(code, /@type \{Props\} \*\/\nconst __props/);
});

test('an empty array without an annotation is usable, not never[]', () => {
  // Annotations are optional. A bare [] used to infer never[], which turned
  // "no annotation" from less checking into a page of errors about a type
  // nobody wrote.
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script properties>export default { columns: [] };</script>
<th each="c of columns">\${c.length}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('an unannotated parameter is plain JavaScript, not an error', () => {
  // JSDoc is optional. A parameter with no declared type is `any`, the same as it
  // would be in any other .js file.
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script properties>export default { columns: [] };</script>
<script>
  export const prototype = {
    add(column) { this.columns = [...this.columns, column]; },
  };
  host.addEventListener('click', (event) => void event, { signal });
</script>
<th each="c of columns">\${c}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('a helper the prototype reads is resolvable in the shim', () => {
  // The helper is hoisted with the members in the generated module, so the shim
  // has to copy it too, or tsc reports a name the browser resolves fine.
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script properties>export default { columns: [] };</script>
<script>
  const LIMIT = 3;
  export const prototype = {
    /** @returns {number} */
    get shown() { return Math.min(this.columns.length, LIMIT); },
  };
  host.addEventListener('click', () => void 0, { signal });
</script>
<th>\${columns.length}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('setup code is not checked, because host, shadow and signal are in scope', () => {
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script properties>export default { columns: [] };</script>
<script>
  export const prototype = { go() { return this.columns; } };
  host.addEventListener('click', () => shadow.append(signal), { signal });
</script>
<th>\${columns.length}</th>`,
  });
  assert.deepEqual(checker.check(path.join(dir, 'app/elements/data-table.html')), []);
});

test('strict: true puts the annotations back on the critical path', () => {
  const { dir, checker } = project(
    {
      'app/elements/data-table.html': `<script properties>export default { columns: [] };</script>
<script>
  export const prototype = { add(column) { void column; } };
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
    'app/elements/data-table.html': `<script properties>export default { columns: [] };</script>
<th>\${colums.length}</th>`,
  });
  const [diagnostic] = checker.check(path.join(dir, 'app/elements/data-table.html'));
  assert.match(diagnostic.message, /colums/);
});

test('the same file with an annotation checks clean', () => {
  const { dir, checker } = project({
    'app/elements/data-table.html': `<script properties>
/** @type {{ columns: string[] }} */
export default { columns: [] };
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
  'app/elements/user-card.html': `<script properties>
export default { name: '' };
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
  assert.match(diagnostic.message, /not assignable to type 'Response \| Promise<Response>'/);
});

test('a handler that returns a bare object is an error', () => {
  const [diagnostic] = endpointErrors('export const POST = () => ({ ok: true });');
  assert.match(diagnostic.message, /not assignable to type 'Response \| Promise<Response>'/);
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
  assert.match(diagnostic.message, /not assignable to type 'Response \| Promise<Response>'/);
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
