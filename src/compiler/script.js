// Real ESM handling for <script server>, <script props> and <script>.
//
// These blocks are authored as modules so editors treat them as JS, but they end
// up spliced into a generated module (or, for client blocks, into a function
// body). Doing that with regex silently mangles `export default` inside a
// comment, multi-line imports, and anything else that merely looks like one.
// acorn gives exact node ranges, so every rewrite here is a string splice at a
// position the parser vouched for.

import { parse } from 'acorn';

export class ScriptError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScriptError';
  }
}

const PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  allowAwaitOutsideFunction: true,
};

/**
 * Rewrites `export default <thing>` to `const <name> = <thing>` in place,
 * leaving imports and named exports exactly where the author put them.
 * Returns the exported names so callers can check them against the names the
 * generated module already uses.
 */
export function bindDefaultExport(block, name, label, { flag = null } = {}) {
  const { code: source, line = 1 } = block;
  const ast = parseOrThrow(source, label, line);

  // `flag` names an export that is a fact about the element rather than part of
  // this block's own shape. It is read out here and blanked, not removed, so
  // every offset after it still points where it did.
  const found = flag ? literalExport(ast, flag, source, line, label) : null;
  const code = found ? blank(source, [[found.start, found.end]]) : source;
  const formAssociated = found ? found.value : null;

  // acorn rejects a duplicate `default` itself, so there is at most one.
  const node = ast.body.find((s) => s.type === 'ExportDefaultDeclaration') ?? null;
  const exports = namedExportsOf(ast, source, line, label).filter((n) => n !== flag);
  const imports = importsOf(ast);

  if (!node) {
    return {
      code: `${code}\nconst ${name} = null;`,
      exports,
      imports,
      defaultNode: null,
      formAssociated,
    };
  }

  // Slicing the *declaration* rather than the statement means
  // `export default function f() {}` becomes `const x = function f() {}`,
  // which is a valid expression for every form of default export.
  const rewritten =
    code.slice(0, node.start) +
    `const ${name} = ` +
    code.slice(node.declaration.start, node.declaration.end) +
    ';' +
    code.slice(node.end);

  return { code: rewritten, exports, imports, defaultNode: node.declaration, formAssociated };
}

/**
 * `export const NAME = true` or `= false`, read out of a block.
 *
 * `null` when the block does not declare it, which is not the same as declaring
 * it false. A component may say so in one block or the other, and telling those
 * apart is what makes "declared in both" reportable.
 */
function literalExport(ast, flag, code, line, label) {
  for (const statement of ast.body) {
    if (!statement.type.startsWith('Export')) continue;

    const value = booleanExport(statement, flag);
    if (value !== null) return { value, start: statement.start, end: statement.end };

    if (namesExport(statement, flag)) {
      throw new ScriptError(
        `${label}: \`${flag}\` must be \`true\` or \`false\`. It becomes a static ` +
          `class field, the same for every element of this tag, so it cannot be decided at ` +
          `run time (line ${lineOf(statement, code, line)})`,
      );
    }
  }

  return null;
}

/**
 * Turns a client <script> into a function body: imports are lifted out (they
 * have to stay at module top level) and everything else is left alone, blanked
 * in place so line and column numbers still line up with the .html file.
 *
 * `lift` names one export that is not setup code: the element's members. It goes
 * to module scope, and so does anything it reads, because a prototype is shared by
 * every instance and the function body is not.
 */
export function toFunctionBody(blocks, label, { lift = null, binding = '__members' } = {}) {
  const imports = [];
  const hoisted = [];
  const bodies = [];
  let lifted = null;
  // `null` until a block declares it, so "not said" and "said false" differ.
  let formAssociated = null;

  for (const block of blocks) {
    const { code, line = 1 } = block;
    // This block becomes a function body, so a top-level `return` is legal here
    // even though it would not be in a module. That is how cleanup is declared.
    const ast = parseOrThrow(code, label, line, { allowReturnOutsideFunction: true });
    const cuts = [];

    const plan = lift ? planLift(ast, lift) : null;
    if (plan) {
      if (lifted) {
        throw new ScriptError(
          `${label}: \`${lift}\` is exported twice (line ${lineOf(plan.statement, code, line)})`,
        );
      }
      if (plan.reaches.length) {
        throw new ScriptError(
          `${label}: \`${lift}\` reaches \`${plan.reaches.join('`, `')}\`, which exists once ` +
            `per element. Members live on the prototype and are shared by every instance, ` +
            `so they reach their own element through \`this\` instead ` +
            `(line ${lineOf(plan.statement, code, line)})`,
        );
      }

      // Order is preserved, so the hoisted code means exactly what it would have
      // meant written at the top of the block.
      for (const dependency of plan.deps) {
        hoisted.push(code.slice(dependency.start, dependency.end));
        cuts.push([dependency.start, dependency.end]);
      }
      hoisted.push(`const ${binding} = ${code.slice(plan.init.start, plan.init.end)};`);
      cuts.push([plan.statement.start, plan.statement.end]);
      lifted = plan.init;
    }

    for (const statement of ast.body) {
      if (statement.type === 'ImportDeclaration') {
        imports.push(code.slice(statement.start, statement.end));
        cuts.push([statement.start, statement.end]);
        continue;
      }
      if (statement.type.startsWith('Export')) {
        if (plan && statement === plan.statement) continue;

        const flag = booleanExport(statement, 'formAssociated');
        if (flag !== null) {
          // A static class field, decided once for every element of this tag, so
          // it has to be a literal. A computed value would look like a per-element
          // choice and could not be one.
          formAssociated = flag;
          cuts.push([statement.start, statement.end]);
          continue;
        }
        if (namesExport(statement, 'formAssociated')) {
          throw new ScriptError(
            `${label}: \`formAssociated\` must be \`true\` or \`false\`. It becomes a static ` +
              `class field, the same for every element of this tag, so it cannot be decided at ` +
              `run time (line ${lineOf(statement, code, line)})`,
          );
        }

        throw new ScriptError(
          `${label}: a client <script> runs as setup code, so it cannot export` +
            (lift ? ` anything but \`${lift}\` and \`formAssociated\`` : '') +
            ` (line ${lineOf(statement, code, line)})`,
        );
      }
    }

    bodies.push(blank(code, cuts));
  }

  return {
    imports: imports.join('\n'),
    hoisted: hoisted.join('\n\n'),
    body: bodies.join('\n'),
    lifted,
    formAssociated,
  };
}

/** What only exists once the element does, and so cannot be reached from a prototype. */
const PER_INSTANCE = ['host', 'shadow', 'signal', 'internals'];

/** `export const NAME = true` / `= false`, or null when it is not that. */
function booleanExport(statement, name) {
  const declared = namesExport(statement, name);
  const init = declared?.init;
  if (init?.type === 'Literal' && typeof init.value === 'boolean') return init.value;
  return null;
}

function namesExport(statement, name) {
  if (statement.type !== 'ExportNamedDeclaration') return null;
  if (statement.declaration?.type !== 'VariableDeclaration') return null;
  return (
    statement.declaration.declarations.find(
      (d) => d.id.type === 'Identifier' && d.id.name === name,
    ) ?? null
  );
}

/**
 * The plan for hoisting one named export out of a client block: the statement
 * itself, its initializer, and the top-level declarations it reads. Those have to
 * come along, or the hoisted code names things that stayed behind.
 *
 * Shared with the shim, which copies the same slices so tsc resolves what the
 * generated module resolves.
 */
export function planLift(ast, name, perInstance = PER_INSTANCE) {
  const statement = ast.body.find(
    (node) =>
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration' &&
      node.declaration.declarations.length === 1 &&
      node.declaration.declarations[0].id.type === 'Identifier' &&
      node.declaration.declarations[0].id.name === name &&
      node.declaration.declarations[0].init,
  );
  if (!statement) return null;

  const init = statement.declaration.declarations[0].init;
  const owners = new Map();
  for (const node of ast.body) {
    if (node === statement) continue;
    for (const declared of declaredNames(node)) owners.set(declared, node);
  }

  const instance = new Set(perInstance);
  const reaches = new Set();
  const reads = new Set();
  const deps = [];
  const seen = new Set();
  const queue = [init];

  while (queue.length) {
    for (const free of freeNames(queue.shift(), new Set(), new Set())) {
      reads.add(free);
      if (instance.has(free)) reaches.add(free);
      const owner = owners.get(free);
      if (!owner || seen.has(owner)) continue;
      seen.add(owner);
      deps.push(owner);
      queue.push(owner);
    }
  }

  deps.sort((a, b) => a.start - b.start);
  return { statement, init, deps, reads, reaches: [...reaches] };
}

/** The names a top-level statement binds. */
function declaredNames(statement) {
  const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
  if (node?.type === 'VariableDeclaration') {
    return node.declarations.flatMap((declarator) => patternNames(declarator.id));
  }
  if (node?.type === 'FunctionDeclaration' || node?.type === 'ClassDeclaration') {
    return node.id ? [node.id.name] : [];
  }
  return [];
}

function scopedNames(statements) {
  return (statements ?? []).flatMap(declaredNames);
}

/**
 * Identifiers a subtree reads from outside itself.
 *
 * Scopes are tracked rather than ignored: a method with a parameter named
 * `host` is not reaching for the element, and reporting it as one would be a
 * confusing error about code that is correct.
 */
function freeNames(node, bound, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) freeNames(child, bound, out);
    return out;
  }
  if (typeof node.type !== 'string') return out;

  switch (node.type) {
    case 'Identifier':
      if (!bound.has(node.name)) out.add(node.name);
      return out;

    // `a.b` reads `a`; `b` is a property name, not a binding.
    case 'MemberExpression':
      freeNames(node.object, bound, out);
      if (node.computed) freeNames(node.property, bound, out);
      return out;
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
      if (node.computed) freeNames(node.key, bound, out);
      freeNames(node.value, bound, out);
      return out;

    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const inner = new Set(bound);
      if (node.id) inner.add(node.id.name);
      for (const param of node.params) for (const name of patternNames(param)) inner.add(name);
      if (node.body.type === 'BlockStatement') for (const name of scopedNames(node.body.body)) inner.add(name);
      // A default is evaluated in the function's own scope, so it sees the params.
      for (const param of node.params) freeNames(param, inner, out);
      freeNames(node.body, inner, out);
      return out;
    }
    case 'BlockStatement': {
      const inner = new Set(bound);
      for (const name of scopedNames(node.body)) inner.add(name);
      for (const statement of node.body) freeNames(statement, inner, out);
      return out;
    }
    case 'ForStatement':
    case 'ForOfStatement':
    case 'ForInStatement': {
      const inner = new Set(bound);
      const head = node.init ?? node.left;
      if (head?.type === 'VariableDeclaration') {
        for (const declarator of head.declarations) {
          for (const name of patternNames(declarator.id)) inner.add(name);
        }
      }
      for (const key of ['init', 'left', 'right', 'test', 'update', 'body']) {
        if (node[key]) freeNames(node[key], inner, out);
      }
      return out;
    }
    case 'CatchClause': {
      const inner = new Set(bound);
      if (node.param) for (const name of patternNames(node.param)) inner.add(name);
      freeNames(node.body, inner, out);
      return out;
    }
    case 'ClassDeclaration':
    case 'ClassExpression': {
      const inner = new Set(bound);
      if (node.id) inner.add(node.id.name);
      freeNames(node.superClass, inner, out);
      freeNames(node.body, inner, out);
      return out;
    }
    // The declared name is bound by the enclosing block already; a destructuring
    // pattern can still carry defaults that read from outside.
    case 'VariableDeclarator':
      if (node.id.type !== 'Identifier') freeNames(node.id, bound, out);
      freeNames(node.init, bound, out);
      return out;

    case 'ImportDeclaration':
    case 'ExportAllDeclaration':
    case 'BreakStatement':
    case 'ContinueStatement':
      return out;

    default:
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
        freeNames(node[key], bound, out);
      }
      return out;
  }
}

/** Module-level client code (a page entry) only needs validating. */
export function assertModule(blocks, label) {
  for (const block of blocks) parseOrThrow(block.code, label, block.line ?? 1);
  return blocks.map((b) => b.code).join('\n');
}

/**
 * Bindings a `<script server>` block pulls in, so the shapes of imported values
 * can be resolved by whoever owns the filesystem.
 */
function importsOf(ast) {
  const out = [];
  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    out.push({
      source: statement.source.value,
      specifiers: statement.specifiers.map((spec) => ({
        local: spec.local.name,
        imported:
          spec.type === 'ImportDefaultSpecifier'
            ? 'default'
            : (spec.imported?.name ?? spec.imported?.value ?? spec.local.name),
        namespace: spec.type === 'ImportNamespaceSpecifier',
      })),
    });
  }
  return out;
}

/** Guards against a block exporting a name the generated module already uses. */
export function assertNoCollisions(exports, reserved, label) {
  for (const name of exports) {
    if (reserved.has(name)) {
      throw new ScriptError(
        `${label}: exports "${name}", which the generated module already defines. ` +
          `Reserved: ${[...reserved].join(', ')}.`,
      );
    }
  }
}

/**
 * A page's handlers are verb exports. An `actions` object is what they used to
 * be, and nothing reads one now, so leaving it would answer 405 to every form
 * on the page and say nothing about why.
 */
export function assertNoActionsObject(exports, label) {
  if (!exports.includes('actions')) return;

  throw new ScriptError(
    `${label}: exports "actions", which nothing reads. Handlers are named for ` +
      `their method now: export const POST = (ctx) => …, and the same for PUT, ` +
      `PATCH and DELETE.`,
  );
}

// ---- internals ------------------------------------------------------------

function parseOrThrow(code, label, lineOffset, extra = {}) {
  try {
    return parse(code, { ...PARSE_OPTIONS, ...extra });
  } catch (err) {
    const line = (err.loc?.line ?? 1) + lineOffset - 1;
    const message = String(err.message).replace(/\s*\(\d+:\d+\)$/, '');
    throw new ScriptError(`${label}: ${message} (line ${line})`);
  }
}

function namedExportsOf(ast, code, lineOffset, label) {
  const names = [];

  for (const statement of ast.body) {
    if (statement.type === 'ExportAllDeclaration') {
      throw new ScriptError(
        `${label}: \`export *\` is not supported here. Its names cannot be checked ` +
          `against the generated module (line ${lineOf(statement, code, lineOffset)})`,
      );
    }
    if (statement.type !== 'ExportNamedDeclaration') continue;

    if (statement.declaration) {
      const decl = statement.declaration;
      if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) names.push(...patternNames(d.id));
      } else if (decl.id) {
        names.push(decl.id.name);
      }
      continue;
    }
    for (const spec of statement.specifiers) {
      names.push(spec.exported.name ?? spec.exported.value);
    }
  }

  return names;
}

function patternNames(node) {
  switch (node.type) {
    case 'Identifier':
      return [node.name];
    case 'ObjectPattern':
      return node.properties.flatMap((p) =>
        p.type === 'RestElement' ? patternNames(p.argument) : patternNames(p.value),
      );
    case 'ArrayPattern':
      return node.elements.filter(Boolean).flatMap(patternNames);
    case 'AssignmentPattern':
      return patternNames(node.left);
    case 'RestElement':
      return patternNames(node.argument);
    default:
      return [];
  }
}

// Blanks out ranges without changing any other character's line or column, so
// stack traces into the generated module still point at the right spot.
function blank(code, cuts) {
  let out = code;
  for (const [start, end] of cuts) {
    out = out.slice(0, start) + code.slice(start, end).replace(/[^\n]/g, ' ') + out.slice(end);
  }
  return out;
}

function lineOf(node, code, lineOffset) {
  return code.slice(0, node.start).split('\n').length + lineOffset - 1;
}
