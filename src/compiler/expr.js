// Expression layer.
//
// jsep gives a small grammar: no assignment, no arrow functions, no object
// literals, no `new`. That keeps a template declarative rather than a second place
// to write code, and it is what makes collecting references below possible. The
// same thing lets `${user.nmae}` be checked against a known shape.

import jsep from 'jsep';

if (!jsep.binary_ops['??']) jsep.addBinaryOp('??', 1);

// Identifiers resolvable without being template data.
export const GLOBALS = new Set([
  'html',
  // The one interpolation a <script> may carry. It has to resolve to the runtime
  // function rather than to a field of the page's data, or the guard that lets it
  // through would be naming something the author never has.
  'json',
  'Math',
  'JSON',
  'String',
  'Number',
  'Boolean',
  'Array',
  'Object',
  'Date',
  'isNaN',
  'parseInt',
  'parseFloat',
  'undefined',
  'NaN',
  'Infinity',
]);

/**
 * The names in scope at a point in the template, innermost first.
 *
 * A name a scope holds is a loop variable or a block binding and compiles to
 * itself. Anything else is a field of the page's data and compiles to a lookup,
 * which is what makes `${title}` mean `__d.title` with nothing declared.
 */
export class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.vars = new Map();
  }

  declare(name, js, shape) {
    this.vars.set(name, { js, shape });
  }

  lookup(name) {
    for (let s = this; s; s = s.parent) {
      if (s.vars.has(name)) return s.vars.get(name);
    }
    return null;
  }
}

/**
 * A template expression as an AST.
 *
 * Directive values are expressions, not interpolations: `each="tag of tags"` has
 * no `${}` around it, so it is parsed rather than split.
 *
 * @param {string} source
 * @returns {object} a jsep node
 * @throws on an empty or unparseable expression
 */
export function parseExpr(source) {
  const src = String(source).trim();
  if (!src) throw new Error('empty expression');
  return jsep(src);
}

/**
 * An AST back to JavaScript, with every free name resolved against `scope`.
 *
 * @param {object} node a jsep node
 * @param {Scope} scope
 * @returns {string} an expression, safe to place inside the generated render
 */
export function emit(node, scope) {
  switch (node.type) {
    case 'Literal':
      return node.raw !== undefined ? node.raw : JSON.stringify(node.value);

    case 'Identifier': {
      const local = scope.lookup(node.name);
      if (local) return local.js;
      if (GLOBALS.has(node.name)) return node.name;
      return `__d[${JSON.stringify(node.name)}]`;
    }

    case 'MemberExpression':
      return node.computed
        ? `${emit(node.object, scope)}[${emit(node.property, scope)}]`
        : `${emit(node.object, scope)}.${node.property.name}`;

    case 'CallExpression':
      return `${emit(node.callee, scope)}(${node.arguments.map((a) => emit(a, scope)).join(', ')})`;

    case 'UnaryExpression':
      return `(${node.operator}${emit(node.argument, scope)})`;

    case 'BinaryExpression':
    case 'LogicalExpression':
      return `(${emit(node.left, scope)} ${node.operator} ${emit(node.right, scope)})`;

    case 'ConditionalExpression':
      return `(${emit(node.test, scope)} ? ${emit(node.consequent, scope)} : ${emit(node.alternate, scope)})`;

    case 'ArrayExpression':
      return `[${node.elements.map((e) => emit(e, scope)).join(', ')}]`;

    case 'Compound':
      throw new Error('expected a single expression, found several (stray `;` or `,`?)');

    case 'ThisExpression':
      throw new Error('`this` is not available in templates');

    default:
      throw new Error(`unsupported expression node: ${node.type}`);
  }
}

/**
 * @typedef {object} Chain
 * @property {'data'|'scope'} base what the path is rooted at
 * @property {string} name the root's name
 * @property {string[]} path the static segments read from it
 * @property {boolean} open false once a computed access ended the path
 * @property {object} [shape] the loop variable's element type, when known
 */

/**
 * The longest static property path rooted at template data or a loop variable,
 * or null when the root is something we cannot follow (a call result, a
 * literal). A computed access ends the path, so `a.b[i].c` gives `a.b`. Past `[i]`
 * there is no way to know what is being read.
 *
 * @param {object} node
 * @param {Scope} scope
 * @param {object[]} [computed] collects the subscript expressions, which are
 *   themselves reads and have to be walked separately
 * @returns {Chain|null}
 */
export function chainOf(node, scope, computed = []) {
  if (node.type === 'Identifier') {
    const local = scope.lookup(node.name);
    if (local) return { base: 'scope', name: node.name, shape: local.shape, path: [], open: true };
    if (GLOBALS.has(node.name)) return null;
    return { base: 'data', name: node.name, path: [], open: true };
  }

  if (node.type === 'MemberExpression') {
    const inner = chainOf(node.object, scope, computed);
    if (!inner) return null;
    if (node.computed) {
      computed.push(node.property);
      return { ...inner, open: false };
    }
    if (inner.open) return { ...inner, path: [...inner.path, node.property.name] };
    return inner;
  }

  return null;
}

/**
 * Every jsep node key that can hold another node. Anything else on a node is a
 * name, a value or a flag, and walking into one finds nothing.
 */
const CHILD_KEYS = [
  'argument', 'left', 'right', 'test', 'consequent', 'alternate', 'object', 'property',
];

/**
 * Every data or loop-variable path an expression reads.
 *
 * This is what decides which bindings are volatile, and so whether a light
 * element can write an update in place or needs a shadow root to rebuild.
 *
 * @param {object} node
 * @param {Scope} scope
 * @param {Chain[]} [out] accumulator, so a caller can collect across several
 * @returns {Chain[]} one entry per read, in the order they were found
 */
export function collectRefs(node, scope, out = []) {
  if (!node || typeof node !== 'object') return out;

  switch (node.type) {
    case 'Identifier':
    case 'MemberExpression': {
      const computed = [];
      const chain = chainOf(node, scope, computed);
      if (chain) {
        out.push(chain);
        for (const inner of computed) collectRefs(inner, scope, out);
      } else if (node.type === 'MemberExpression') {
        collectRefs(node.object, scope, out);
        if (node.computed) collectRefs(node.property, scope, out);
      }
      return out;
    }

    case 'CallExpression':
      // The callee path is collected in full: a method that does not exist is
      // as much a typo as a property that does not.
      collectRefs(node.callee, scope, out);
      for (const arg of node.arguments) collectRefs(arg, scope, out);
      return out;

    default:
      for (const key of CHILD_KEYS) {
        if (node[key]) collectRefs(node[key], scope, out);
      }

      for (const element of node.elements ?? []) collectRefs(element, scope, out);
      return out;
  }
}
