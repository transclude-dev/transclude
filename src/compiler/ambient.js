// The types a shim declares for itself, in one place.
//
// A shim writes JSDoc and transclude-env.d.ts writes TypeScript, so the same
// shape had two spellings and only one of them was ever written. Every context
// type in the emitted file named `__Cookies` and nothing declared it, which no
// check reported: a jsconfig.json implies `skipLibCheck`, and the guard in
// `bin/check.js` written to catch exactly this passes it too, so the file it
// checks is the one kind of file that flag skips.

/**
 * Each entry is one type, written the way TypeScript spells it. `params` are the
 * type parameters, which JSDoc writes as `@template` and a `.d.ts` writes in
 * angle brackets.
 */
export const AMBIENT = [
  {
    name: '__CookieOptions',
    params: [],
    text:
      "{ path?: string; domain?: string; maxAge?: number; expires?: Date; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }",
  },
  {
    name: '__Cookies',
    params: [],
    text:
      '{ get(name: string): string | undefined; all(): Record<string, string>; ' +
      'set(name: string, value: string, options?: __CookieOptions): void; ' +
      'delete(name: string, options?: __CookieOptions): void; ' +
      'signed: { get(name: string): Promise<string | undefined>; ' +
      'all(): Promise<Record<string, string>>; ' +
      'set(name: string, value: string, options?: __CookieOptions): Promise<void> } }',
  },
  {
    // The mapping is what keeps `${user.nmae}` an error. TypeScript treats a type
    // that came straight from an object literal in a .js file as open for expando
    // properties, so reading an undeclared one is allowed. Remapping the keys
    // gives an ordinary object type, where it is not.
    //
    // The conditional widens a bare `[]`, which otherwise infers `never[]` and
    // turns "no annotation" from "less checking" into a page of errors about a
    // type nobody wrote.
    name: '__Shape',
    params: ['T'],
    text: '{ [K in keyof T]: T[K] extends never[] ? any[] : T[K] }',
  },
];

export const AMBIENT_NAMES = new Set(AMBIENT.map(({ name }) => name));

/**
 * The JSDoc a shim carries for the given names. A name JSDoc cannot resolve is
 * `any` rather than an error, so a shim that names one of these without this is
 * checking nothing and saying so nowhere.
 *
 * @param {string[]} names
 * @returns {string}
 */
export function ambientJsdoc(names) {
  return AMBIENT.filter(({ name }) => names.includes(name))
    .map(({ name, params, text }) => {
      const template = params.length ? ` * @template ${params.join(', ')}\n` : '';
      return `/**\n${template} * @typedef {${text}} ${name}\n */\n`;
    })
    .join('');
}

/**
 * The same types as TypeScript declarations, for the emitted file. Only the ones
 * it mentions: an unused type in a generated file is noise.
 *
 * @param {string} body what the file says so far
 * @param {(type: string) => string} [format] how to lay a type out
 * @returns {string[]} the lines to put above it
 */
export function ambientDeclarations(body, format = (type) => type) {
  // One of these names another, so keep looking until a pass adds nothing:
  // `__Cookies` alone would leave `__CookieOptions` undeclared, which is the
  // whole bug again one level down.
  const used = [];
  for (let text = body, added = true; added; ) {
    added = false;
    for (const type of AMBIENT) {
      if (used.includes(type) || !new RegExp(`\\b${type.name}\\b`).test(text)) continue;
      used.push(type);
      text += type.text;
      added = true;
    }
  }
  if (!used.length) return [];

  return [
    '// Declared by the compiler. Every context type below names these.',
    ...used.map(({ name, params, text }) => {
      const generics = params.length ? `<${params.join(', ')}>` : '';
      return `type ${name}${generics} = ${format(text)};`;
    }),
    '',
  ];
}
