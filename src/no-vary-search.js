// Whether a `No-Vary-Search` header would hide the parameter a fragment is
// asked for with.
//
// The header tells a cache that two URLs differing only in some parameter are
// one URL. That is true of `utm_source` and false of `fragment`: `/notes` is the
// document and `/notes?fragment=list` is one piece of it, with a different body
// at the same path. A cache told to ignore the difference answers the second
// with the first, and a swap writes the whole page into the element it should
// have replaced. That is the same failure an undefined `fragmentParam` caused on
// workerd, and it left no error either.
//
// So the framework reads the header on its way out and refuses the values that
// would do it. `except=()` is the one to watch, because it is the shortest thing
// to write and it ignores everything.
//
// The header is a structured-field dictionary, RFC 9651, and it is parsed here
// the way a cache parses it, all of it. Three drills each found a shape a
// shorter reader got wrong: a member that broke the grammar, a parameter on an
// item, a decimal with four places. A cache ignores a header that does not
// parse, so the question "does it parse" needs the whole grammar to answer.
//
// Two drafts are in use. Browsers shipped an older one, where bare `params`
// ignores every parameter and `except` goes beside it. The current one,
// section 5.1, takes only a list for `params`, reads `except` on its own as
// the allowlist, and ignores a header that has both. A value passes only when
// neither draft hides the parameter.
//
// The file has two halves. The first says what the members mean. The second is
// the parser, one function per step of RFC 9651, section 4.2.
//
// No `node:` imports. This reads a string.

/**
 * Whether a cache reading `value` would treat `param` as making no difference.
 *
 * `key-order` alone is fine: it reorders and ignores nothing. An empty
 * `params=()` is fine for the same reason. An empty `except=()` is the opposite,
 * because an allowlist of nothing allows nothing to matter.
 *
 * A value naming `params` or `except` in a shape this cannot read counts as
 * hiding. Being wrong that way costs an author one error naming their header;
 * being wrong the other way costs a reader a broken swap and says nothing.
 *
 * @param {string|null|undefined} value the `No-Vary-Search` header
 * @param {string} param the parameter to ask about
 * @returns {boolean}
 */
export function hidesParam(value, param) {
  if (!value || !param) return false;

  const dictionary = parseDictionary(value);

  // A cache ignores a header that does not parse. One that names `params` or
  // `except` was meant to hide something, so it is refused as unreadable. One
  // that names neither, such as `PARAMS`, hides nothing.
  if (!dictionary) return namesParamsOrExcept(value);

  // A cache also ignores a header whose `key-order` is not a boolean, though it
  // parses. The same rule holds: one that names `params` or `except` is refused.
  if (!keyOrderReads(dictionary.get('key-order'))) return dictionary.has('params') || dictionary.has('except');

  const params = dictionary.get('params');
  const except = dictionary.get('except');

  if (except) return exceptHides(params, except, param);
  if (params) return paramsHides(params, param);
  return false;
}

/**
 * Throws when the header would hide the fragment parameter.
 *
 * Called on the way out rather than checked at boot, because the header can come
 * from a loader's `ctx.response` or from the app's own middleware, and neither
 * runs during a build.
 *
 * @param {string|null|undefined} value the `No-Vary-Search` header
 * @param {string|null|undefined} param the configured `fragmentParam`
 * @throws when a cache reading the header would ignore `param`
 */
export function refuseHiddenFragment(value, param) {
  if (!param || !hidesParam(value, param)) return;

  throw new Error(
    `[transclude] a No-Vary-Search header on this response hides \`?${param}=\`, ` +
      `which is how a fragment is asked for. A cache reading it would answer ` +
      `\`?${param}=list\` with the whole document, and a swap would write the page ` +
      `into the element it should have replaced. Name the parameters you mean: ` +
      `\`params=("utm_source" "gclid")\`, or \`except=("${param}")\` to keep this ` +
      `one varying. Header: ${value}`,
  );
}

// ---- what the members mean -------------------------------------------------

/**
 * `params` on its own. A list ignores the names in it, in both drafts. Bare
 * `params`, or `?1`, ignores every parameter in the older draft, so it hides.
 * `?0` ignores none in the older draft, and the current one ignores a `params`
 * that is not a list, so it passes. Any other shape is one a cache might read
 * some other way, so it counts as hiding.
 *
 * A bare key with parameters, `params;x`, is still the bare key: an older draft
 * that browsers shipped reads it as every parameter.
 */
function paramsHides(params, param) {
  if (isBoolean(params, true)) return true;
  if (isBoolean(params, false)) return false;

  const names = stringNames(params);
  if (!names) return true;
  return names.includes(param);
}

/**
 * `except` is an allowlist on top of "ignore every parameter": every parameter
 * it leaves out is ignored. The current draft reads it so on its own, and the
 * older draft beside bare `params`. A name in the list varies in both, and in
 * the other draft the header is ignored, so a listed name passes. The drill
 * that rebuilt this module refused `except=("fragment")`, which is the value
 * the refusal tells an author to write.
 *
 * Beside a list or `?0` neither draft reads it: the older one fails it and the
 * current one ignores both keys. A shape that cannot be read counts as hiding.
 */
function exceptHides(params, except, param) {
  if (params && !isBoolean(params, true)) return true;

  const names = stringNames(except);
  if (!names) return true;
  return !names.includes(param);
}

/** `key-order` absent, bare, `?1` or `?0`. Both drafts ignore the header otherwise. */
function keyOrderReads(keyOrder) {
  if (!keyOrder) return true;
  return keyOrder.type === 'boolean';
}

function isBoolean(member, wanted) {
  return member.type === 'boolean' && member.value === wanted;
}

/**
 * The names in an inner list of strings, decoded, or null for any other shape.
 * A token is not a name: `("utm_source")` names one and `(utm_source)` does not.
 * The parameters on the list and on each item say nothing here.
 */
function stringNames(member) {
  if (member.type !== 'list') return null;

  const names = [];
  for (const item of member.items) {
    if (item.type !== 'string') return null;
    names.push(decodeKey(item.value));
  }
  return names;
}

/**
 * A name as a cache compares it, decoded the way a query key is: `+` is a
 * space, and `%61` is `a`. The draft says so (section 5.3), so `"fr%61gment"`
 * hides `?fragment=` as surely as `"fragment"` does.
 *
 * A `%` that does not start two hex digits stays as it is, as in a URL.
 *
 * @param {string} name
 * @returns {string}
 */
function decodeKey(name) {
  const bytes = new TextEncoder().encode(name.replaceAll('+', ' '));
  const decoded = [];

  for (let i = 0; i < bytes.length; i++) {
    const hex = String.fromCharCode(bytes[i + 1], bytes[i + 2]);
    if (bytes[i] === 0x25 && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      decoded.push(parseInt(hex, 16));
      i += 2;
      continue;
    }
    decoded.push(bytes[i]);
  }

  return new TextDecoder().decode(new Uint8Array(decoded));
}

/**
 * Whether a header that does not parse names `params` or `except` as a key.
 *
 * It does not parse, so this splits it at the commas between members, minding
 * quotes and parentheses, and reads each key up to `=` or `;`. `utmparams`
 * is not `params`, and `PARAMS` is not either.
 *
 * @param {string} value
 */
function namesParamsOrExcept(value) {
  for (const member of splitMembers(value)) {
    const key = member.split(/[=;]/)[0].trim();
    if (key === 'params' || key === 'except') return true;
  }
  return false;
}

/**
 * The header cut at each comma that is outside a quoted string and outside a
 * list. A backslash in a quoted string escapes the next character.
 *
 * @param {string} value
 * @returns {string[]}
 */
function splitMembers(value) {
  const members = [];
  let current = '';
  let inString = false;
  let depth = 0;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (inString && char === '\\') {
      current += char + (value[i + 1] ?? '');
      i++;
      continue;
    }
    if (char === '"') inString = !inString;
    if (!inString && char === '(') depth++;
    if (!inString && char === ')') depth--;

    if (!inString && depth === 0 && char === ',') {
      members.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  members.push(current);
  return members;
}

// ---- the parser, RFC 9651, section 4.2 --------------------------------------
//
// Each step reads from a cursor and calls `fail` when the text breaks the
// grammar. `parseDictionary` catches that once and answers null. A member is
// `{ type, value }` for an item and `{ type: 'list', items }` for an inner
// list. Parameters are parsed, so that a bad one fails the header, and then
// dropped, because nothing here reads them.

class ParseFailure extends Error {}

/** @returns {never} */
function fail() {
  throw new ParseFailure();
}

/**
 * The dictionary as a Map from key to member, or null when it does not parse.
 * A repeated key keeps its last value, as the RFC says.
 *
 * @param {string} text
 * @returns {Map<string, any>|null}
 */
function parseDictionary(text) {
  // HTTP has already dropped the whitespace around the value. A value set by
  // hand may still carry some.
  const cursor = { text: text.trim(), at: 0 };
  try {
    return readDictionary(cursor);
  } catch (error) {
    if (error instanceof ParseFailure) return null;
    throw error;
  }
}

function readDictionary(cursor) {
  const dictionary = new Map();

  while (!atEnd(cursor)) {
    const key = readKey(cursor);
    dictionary.set(key, readMember(cursor));

    skipWhitespace(cursor);
    if (atEnd(cursor)) return dictionary;
    expect(cursor, ',');
    skipWhitespace(cursor);
    // A comma at the end is not allowed.
    if (atEnd(cursor)) fail();
  }
  return dictionary;
}

/** After a key: `=` and a value, or nothing, which is the boolean true. */
function readMember(cursor) {
  if (peek(cursor) !== '=') {
    readParameters(cursor);
    return { type: 'boolean', value: true };
  }

  cursor.at++;
  if (peek(cursor) === '(') return readInnerList(cursor);
  return readItem(cursor);
}

function readInnerList(cursor) {
  expect(cursor, '(');
  const items = [];

  while (!atEnd(cursor)) {
    skipSpaces(cursor);
    if (peek(cursor) === ')') {
      cursor.at++;
      readParameters(cursor);
      return { type: 'list', items };
    }

    items.push(readItem(cursor));
    // Two items with nothing between them are not a list.
    if (peek(cursor) !== ' ' && peek(cursor) !== ')') fail();
  }

  // The list never closed.
  return fail();
}

function readItem(cursor) {
  const item = readBareItem(cursor);
  readParameters(cursor);
  return item;
}

function readParameters(cursor) {
  while (peek(cursor) === ';') {
    cursor.at++;
    skipSpaces(cursor);
    readKey(cursor);
    if (peek(cursor) !== '=') continue;
    cursor.at++;
    readBareItem(cursor);
  }
}

/** A lowercase letter or `*`, then letters, digits, `_`, `-`, `.` and `*`. */
function readKey(cursor) {
  if (!/^[a-z*]$/.test(peek(cursor))) fail();

  const start = cursor.at;
  while (/^[a-z0-9_\-.*]$/.test(peek(cursor))) cursor.at++;
  return cursor.text.slice(start, cursor.at);
}

function readBareItem(cursor) {
  const first = peek(cursor);
  if (first === '-' || /^[0-9]$/.test(first)) return readNumber(cursor);
  if (first === '"') return readString(cursor);
  if (first === '*' || /^[A-Za-z]$/.test(first)) return readToken(cursor);
  if (first === ':') return readByteSequence(cursor);
  if (first === '?') return readBoolean(cursor);
  if (first === '@') return readDate(cursor);
  if (first === '%') return readDisplayString(cursor);
  return fail();
}

/** An integer of up to 15 digits, or a decimal of up to 12, a dot, then 1 to 3. */
const INTEGER = /^-?[0-9]{1,15}$/;
const DECIMAL = /^-?[0-9]{1,12}\.[0-9]{1,3}$/;

function readNumber(cursor) {
  const start = cursor.at;
  if (peek(cursor) === '-') cursor.at++;
  while (/^[0-9.]$/.test(peek(cursor))) cursor.at++;

  const text = cursor.text.slice(start, cursor.at);
  if (INTEGER.test(text)) return { type: 'integer', value: Number(text) };
  if (DECIMAL.test(text)) return { type: 'decimal', value: Number(text) };
  return fail();
}

/** A quoted string: printable ASCII, with `\"` and `\\` as the only escapes. */
function readString(cursor) {
  expect(cursor, '"');
  let value = '';

  while (!atEnd(cursor)) {
    const char = take(cursor);
    if (char === '"') return { type: 'string', value };

    if (char === '\\') {
      const escaped = take(cursor);
      if (escaped !== '"' && escaped !== '\\') fail();
      value += escaped;
      continue;
    }

    if (!isPrintableAscii(char)) fail();
    value += char;
  }

  // The string never closed.
  return fail();
}

/** A token begins with a letter or `*`, then any tchar, `:` or `/`. */
function readToken(cursor) {
  const start = cursor.at;
  cursor.at++;
  while (/^[!#$%&'*+\-.^_`|~0-9A-Za-z:/]$/.test(peek(cursor))) cursor.at++;
  return { type: 'token', value: cursor.text.slice(start, cursor.at) };
}

function readByteSequence(cursor) {
  expect(cursor, ':');
  const start = cursor.at;
  while (/^[A-Za-z0-9+/=]$/.test(peek(cursor))) cursor.at++;
  const value = cursor.text.slice(start, cursor.at);
  expect(cursor, ':');
  return { type: 'bytes', value };
}

function readBoolean(cursor) {
  expect(cursor, '?');
  const char = take(cursor);
  if (char === '1') return { type: 'boolean', value: true };
  if (char === '0') return { type: 'boolean', value: false };
  return fail();
}

function readDate(cursor) {
  expect(cursor, '@');
  const number = readNumber(cursor);
  if (number.type !== 'integer') fail();
  return { type: 'date', value: number.value };
}

/**
 * `%"…"`: printable ASCII, with `%` and two lowercase hex digits for each
 * other byte, and the bytes UTF-8.
 */
function readDisplayString(cursor) {
  expect(cursor, '%');
  expect(cursor, '"');
  const bytes = [];

  while (!atEnd(cursor)) {
    const char = take(cursor);
    if (char === '"') return { type: 'display', value: utf8(bytes) };
    if (!isPrintableAscii(char)) fail();

    if (char !== '%') {
      bytes.push(char.charCodeAt(0));
      continue;
    }

    const hex = cursor.text.slice(cursor.at, cursor.at + 2);
    if (!/^[0-9a-f]{2}$/.test(hex)) fail();
    bytes.push(parseInt(hex, 16));
    cursor.at += 2;
  }

  // The string never closed.
  return fail();
}

function utf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return fail();
  }
}

// ---- the cursor -------------------------------------------------------------

function atEnd(cursor) {
  return cursor.at >= cursor.text.length;
}

/** The next character, or `''` at the end, which matches no class above. */
function peek(cursor) {
  return cursor.text[cursor.at] ?? '';
}

function take(cursor) {
  const char = peek(cursor);
  cursor.at++;
  return char;
}

function expect(cursor, char) {
  if (peek(cursor) !== char) fail();
  cursor.at++;
}

/** Spaces only: inside an inner list and before a parameter key. */
function skipSpaces(cursor) {
  while (peek(cursor) === ' ') cursor.at++;
}

/** Spaces and tabs: around the commas between members. */
function skipWhitespace(cursor) {
  while (peek(cursor) === ' ' || peek(cursor) === '\t') cursor.at++;
}

/** Space through `~`, the characters a string may hold. */
function isPrintableAscii(char) {
  return char >= ' ' && char <= '~';
}
