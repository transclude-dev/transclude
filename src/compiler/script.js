// Real ESM handling for <script server>, <script element> and a page's <script>.
//
// These blocks are authored as modules so editors treat them as JS, and they end
// up spliced into a generated module. Doing that with regex silently mangles
// `export default` inside a comment, multi-line imports, and anything else that
// merely looks like one. acorn gives exact node ranges, so every rewrite here is
// a string splice at a position the parser vouched for.

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
 *
 * @param {{ code: string, line?: number }} block
 * @param {string} name what to bind the default export to
 * @param {string} label for an error
 * @returns {{ code: string, exports: string[],
 *   imports: Array<{ source: string, specifiers: string }>,
 *   declared: string[], defaultNode: object|null }}
 */
export function bindDefaultExport(block, name, label) {
  const { code, line = 1 } = block;
  const ast = parseOrThrow(code, label, line);

  // acorn rejects a duplicate `default` itself, so there is at most one.
  const node = ast.body.find((s) => s.type === 'ExportDefaultDeclaration') ?? null;
  const exports = namedExportsOf(ast, code, line, label);
  const imports = importsOf(ast);
  const declared = topLevelNames(ast);

  if (!node) {
    return { code: `${code}\nconst ${name} = null;`, exports, imports, declared, defaultNode: null };
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

  return { code: rewritten, exports, imports, declared, defaultNode: node.declaration };
}

/**
 * The names `<script element>` declares, and what the generated module calls
 * each one. Every other export is refused: this block is read by name, so a
 * name nobody reads is a typo the author should hear about rather than a value
 * that quietly does nothing.
 */
export const ELEMENT_BINDINGS = {
  properties: '__propDefs',
  state: '__stateDefs',
  prototype: '__members',
  attributes: '__propAttrs',
};

/**
 * What an element declares about the tag rather than about one element. Each is
 * the same for every element of it, so each has to be a literal: a computed
 * value would look like a per-element choice and could not be one.
 */
export const ELEMENT_FLAGS = ['shadow', 'formAssociated'];

/**
 * Reads `<script element>`: a module whose reserved exports are rebound to the
 * names the generated module uses, and whose flags are read out as literals.
 *
 * Every splice keeps the block's own length, padding with spaces, so a line and
 * column in the generated module is the line and column in the .html file. Only
 * the reserved names move. Imports, helpers, typedefs and anything else the
 * author wrote stay exactly where they were written, which is the whole point
 * of the block being a real module.
 *
 * @param {{ code: string, line?: number }} block
 * @param {string} label for an error
 * @returns {{ code: string, nodes: Record<string, object|null>, flags: object,
 *   imports: Array<object>, declared: string[], warnings: string[] }}
 */
export function bindElementModule(block, label) {
  const { code, line = 1 } = block;
  const ast = parseOrThrow(code, label, line);

  const nodes = Object.fromEntries(Object.keys(ELEMENT_BINDINGS).map((name) => [name, null]));
  // `null` until the block says so, so "not said" and "said false" differ.
  const flags = Object.fromEntries(ELEMENT_FLAGS.map((flag) => [flag, null]));
  const cuts = [];
  const warnings = [];

  for (const statement of ast.body) {
    if (statement.type === 'ImportDeclaration') continue;

    if (statement.type === 'ExportDefaultDeclaration') {
      throw new ScriptError(
        `${label}: an element declares itself by name, so there is no default export. ` +
          `Write \`export const properties = { … }\` ` +
          `(line ${lineOf(statement, code, line)})`,
      );
    }

    if (!statement.type.startsWith('Export')) continue;

    // Every export here names something reserved, because anything else is
    // refused below. So every one of them declares exactly one name, and asking
    // once removes the whole class of "which declarator did we mean".
    //
    // It used to be asked in one branch and not the other:
    // `export const properties = {…}, shadow = true` matched the flag, blanked
    // the statement whole, and dropped `properties` with no error. The element
    // then coerced no attributes, and a template read the raw string.
    const declared = statement.declaration?.declarations ?? [];
    if (declared.length > 1) {
      const names = declared.map((d) => (d.id.type === 'Identifier' ? d.id.name : '…'));
      throw new ScriptError(
        `${label}: an export here declares one name, and this declares ` +
          `\`${names.join('`, `')}\`. Each is read on its own, so give each its own ` +
          `\`export const\` (line ${lineOf(statement, code, line)})`,
      );
    }

    const flag = ELEMENT_FLAGS.find((name) => namesExport(statement, name));
    if (flag) {
      const value = booleanExport(statement, flag);
      if (value === null) {
        throw new ScriptError(
          `${label}: \`${flag}\` must be \`true\` or \`false\`. It decides something about ` +
            `the tag, the same for every element of it, so it cannot be decided at run time ` +
            `(line ${lineOf(statement, code, line)})`,
        );
      }
      flags[flag] = value;
      // Blanked rather than removed: it is a fact about the tag, read at compile
      // time, and the generated module states it itself.
      cuts.push({ start: statement.start, end: statement.end, text: '' });
      continue;
    }

    const declarator = reservedDeclarator(statement);
    if (declarator) {
      const name = declarator.id.name;
      if (nodes[name]) {
        throw new ScriptError(
          `${label}: \`${name}\` is exported twice (line ${lineOf(statement, code, line)})`,
        );
      }
      nodes[name] = declarator.init;
      // `export const properties = ` becomes `const __propDefs = `, padded, so
      // the initializer keeps the column it was written at.
      cuts.push({
        start: statement.start,
        end: declarator.init.start,
        text: `const ${ELEMENT_BINDINGS[name]} = `,
      });
      continue;
    }

    throw new ScriptError(
      `${label}: \`${exportedName(statement) ?? 'this'}\` is not something an element ` +
        `declares. The block exports ${[...Object.keys(ELEMENT_BINDINGS), ...ELEMENT_FLAGS]
          .map((name) => `\`${name}\``)
          .join(', ')}, and nothing else ` +
        `(line ${lineOf(statement, code, line)})`,
    );
  }

  warnUnsignaled(ast, code, line, warnings);

  // The reserved names are rebound or blanked, so none of them reaches module
  // scope. Reporting them as declarations made `export const formAssociated`
  // collide with the module's own `formAssociated` export, which is the very
  // name the block is supposed to use.
  const reserved = new Set([...Object.keys(ELEMENT_BINDINGS), ...ELEMENT_FLAGS]);

  return {
    code: splice(code, cuts),
    nodes,
    flags,
    imports: importsOf(ast),
    declared: topLevelNames(ast).filter((name) => !reserved.has(name)),
    warnings,
  };
}

/** `export const <reserved> = <init>`, as its declarator, or null. */
function reservedDeclarator(statement) {
  if (statement.type !== 'ExportNamedDeclaration') return null;
  if (statement.declaration?.type !== 'VariableDeclaration') return null;
  if (statement.declaration.declarations.length !== 1) return null;

  const declarator = statement.declaration.declarations[0];
  if (declarator.id.type !== 'Identifier') return null;
  if (!(declarator.id.name in ELEMENT_BINDINGS)) return null;
  if (!declarator.init) return null;

  return declarator;
}

/** The first name an export statement introduces, for an error message. */
function exportedName(statement) {
  if (statement.declaration?.type === 'VariableDeclaration') {
    const [first] = statement.declaration.declarations;
    return first?.id.type === 'Identifier' ? first.id.name : null;
  }
  if (statement.declaration?.id) return statement.declaration.id.name;
  const [spec] = statement.specifiers ?? [];
  return spec ? (spec.exported.name ?? spec.exported.value) : null;
}

/** Targets that outlive the element listening to them. */
const OUTLIVES = new Set(['document', 'window', 'globalThis', 'screen', 'navigator', 'visualViewport']);

/**
 * A listener on something that outlives this element, with no `signal`.
 *
 * A listener on the element itself is collected with it, so it needs nothing.
 * One on `document` is not: the element goes and the listener stays, holding the
 * closure and everything it captured, and every element after it adds another.
 * Nothing reports that, which is why it is worth saying at compile time.
 */
function warnUnsignaled(ast, code, line, warnings) {
  const seen = new Set();

  const looksSignaled = (arg) => {
    if (!arg) return false;
    // A boolean third argument is `capture`, which is the old spelling and
    // carries no signal.
    if (arg.type === 'Literal' && typeof arg.value === 'boolean') return false;
    // Anything else that is not a plain object could hold one, so this only
    // reports the shapes it can read.
    if (arg.type !== 'ObjectExpression') return true;
    return arg.properties.some(
      (property) =>
        property.type === 'SpreadElement' ||
        property.key?.name === 'signal' ||
        property.key?.value === 'signal',
    );
  };

  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;

    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.property?.name === 'addEventListener' &&
      node.callee.object?.type === 'Identifier' &&
      OUTLIVES.has(node.callee.object.name) &&
      !looksSignaled(node.arguments[2])
    ) {
      const target = node.callee.object.name;
      const event = node.arguments[0]?.value;
      const at = lineOf(node, code, line);
      const message =
        `${target}.addEventListener(${event ? `"${event}"` : '…'}) has no \`signal\`, so the ` +
        `listener stays after this element leaves the document. Take \`{ signal }\` in ` +
        `\`connected\` and pass it (line ${at})`;
      if (!seen.has(message)) {
        seen.add(message);
        warnings.push(message);
      }
    }

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === 'string') visit(value);
    }
  };

  visit(ast);
}

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
 * Module-level client code (a page entry) only needs validating.
 *
 * @param {Array<{ code: string, line?: number }>} blocks
 * @param {string} label
 * @returns {void}
 * @throws with the offset mapped back to the .html file
 */
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

/**
 * Guards against a block using a name the generated module already defines.
 *
 * @param {string[]} names
 * @param {Set<string>} reserved
 * @param {string} label
 * @param {string} [verb] how the block used it, for the message
 * @returns {void}
 * @throws naming the first collision
 */
export function assertNoCollisions(names, reserved, label, verb = 'exports') {
  for (const name of names) {
    if (reserved.has(name)) {
      throw new ScriptError(
        `${label}: ${verb} "${name}", which the generated module already defines. ` +
          `Reserved: ${[...reserved].join(', ')}.`,
      );
    }
  }
}

/**
 * A page's handlers are verb exports. An `actions` object is what they used to
 * be, and nothing reads one now, so leaving it would answer 405 to every form
 * on the page and say nothing about why.
 *
 * @param {string[]} exports
 * @param {string} label
 * @returns {void}
 * @throws because nothing reads one, so a page keeping it would 405 in silence
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

/**
 * Every name a block binds at the top level, imports included.
 *
 * The generated module puts this block's code beside its own `export const`
 * statements, so any of these can collide, not only the exported ones. An
 * import was the case that got through: `import { elements } from './x.js'`
 * binds `elements` and exports nothing, so the export check never saw it and
 * the build failed inside rolldown, pointing at a virtual module.
 *
 * @param {object} ast
 * @returns {string[]}
 */
function topLevelNames(ast) {
  return ast.body.flatMap((statement) =>
    statement.type === 'ImportDeclaration'
      ? statement.specifiers.map((spec) => spec.local.name)
      : declaredNames(statement),
  );
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

/**
 * Rewrites ranges, keeping every line where it was.
 *
 * Lines are the promise. A stack frame into the generated module reads a line
 * number, so a range is replaced by text carrying the same newlines the range
 * held. Columns come along wherever there is room: when the replacement is
 * shorter than what it replaced, the rest is padded with spaces and every
 * character after it on that line keeps its column too.
 *
 * Length was the promise once, and it was too strict to hold. `export const
 * state=` is nineteen characters and `const __stateDefs = ` is twenty, so
 * legal code failed to build over one character, with an error naming neither
 * the file nor the line. Nothing maps a component's columns anyway: the source
 * map is built for pages.
 */
function splice(code, cuts) {
  let out = code;
  // Back to front. A replacement may now be longer than what it replaced, and
  // every offset came from the original, so rewriting front to back would leave
  // each later cut off by however much the ones before it grew.
  for (const { start, end, text } of [...cuts].sort((a, b) => b.start - a.start)) {
    // Spaces where the code was, newlines left where they were.
    const kept = code.slice(start, end).replace(/[^\n]/g, ' ');
    const firstBreak = kept.indexOf('\n');
    const room = firstBreak === -1 ? kept.length : firstBreak;
    // Past the first newline the padding would be on the wrong line, so a
    // replacement that does not fit carries the newlines alone.
    const filled = text.length <= room ? text + kept.slice(text.length) : text + kept.replace(/ /g, '');
    out = out.slice(0, start) + filled + out.slice(end);
  }
  return out;
}

function lineOf(node, code, lineOffset) {
  return code.slice(0, node.start).split('\n').length + lineOffset - 1;
}
