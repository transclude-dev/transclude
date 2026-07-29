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
export function bindDefaultExport(block, name, label) {
  const { code, line = 1 } = block;
  const ast = parseOrThrow(code, label, line);

  // acorn rejects a duplicate `default` itself, so there is at most one.
  const node = ast.body.find((s) => s.type === 'ExportDefaultDeclaration') ?? null;
  const exports = namedExportsOf(ast, code, line, label);
  const imports = importsOf(ast);

  if (!node) return { code: `${code}\nconst ${name} = null;`, exports, imports, defaultNode: null };

  // Slicing the *declaration* rather than the statement means
  // `export default function f() {}` becomes `const x = function f() {}`,
  // which is a valid expression for every form of default export.
  const rewritten =
    code.slice(0, node.start) +
    `const ${name} = ` +
    code.slice(node.declaration.start, node.declaration.end) +
    ';' +
    code.slice(node.end);

  return { code: rewritten, exports, imports, defaultNode: node.declaration };
}

/**
 * Turns a client <script> into a function body: imports are lifted out (they
 * have to stay at module top level) and everything else is left alone, blanked
 * in place so line and column numbers still line up with the .html file.
 */
export function toFunctionBody(blocks, label) {
  const imports = [];
  const bodies = [];

  for (const block of blocks) {
    const { code, line = 1 } = block;
    // This block becomes a function body, so a top-level `return` is legal here
    // even though it would not be in a module — that is the cleanup contract.
    const ast = parseOrThrow(code, label, line, { allowReturnOutsideFunction: true });
    const cuts = [];

    for (const statement of ast.body) {
      if (statement.type === 'ImportDeclaration') {
        imports.push(code.slice(statement.start, statement.end));
        cuts.push([statement.start, statement.end]);
        continue;
      }
      if (statement.type.startsWith('Export')) {
        throw new ScriptError(
          `${label}: a client <script> runs as setup code, so it cannot export ` +
            `(line ${lineOf(statement, code, line)})`,
        );
      }
    }

    bodies.push(blank(code, cuts));
  }

  return { imports: imports.join('\n'), body: bodies.join('\n') };
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
        `${label}: \`export *\` is not supported here — its names cannot be checked ` +
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
