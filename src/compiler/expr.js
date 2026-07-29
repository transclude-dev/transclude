// Expression layer.
//
// jsep gives us a deliberately small grammar: no assignment, no arrow
// functions, no object literals, no `new`. That keeps "declarative, not
// scripting" honest and makes the reference collection below tractable — the
// same property that lets us check `${user.nmae}` against a known shape.

import jsep from 'jsep';

if (!jsep.binary_ops['??']) jsep.addBinaryOp('??', 1);

// Identifiers resolvable without being template data.
export const GLOBALS = new Set([
  'html',
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

  // Used for the shadowing warning: does an *enclosing* scope already bind this?
  outerHas(name) {
    for (let s = this.parent; s; s = s.parent) {
      if (s.vars.has(name)) return true;
    }
    return false;
  }
}

export function parseExpr(source) {
  const src = String(source).trim();
  if (!src) throw new Error('empty expression');
  return jsep(src);
}

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
 * The longest static property path rooted at template data or a loop variable,
 * or null when the root is something we cannot follow (a call result, a
 * literal). A computed access closes the path — `a.b[i].c` yields `a.b`,
 * because past `[i]` we no longer know what we are looking at.
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

/** Every data/loop-variable path an expression reads. */
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
      for (const key of ['argument', 'left', 'right', 'test', 'consequent', 'alternate', 'object', 'property']) {
        if (node[key]) collectRefs(node[key], scope, out);
      }
      for (const element of node.elements ?? []) collectRefs(element, scope, out);
      return out;
  }
}
