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
// The header is a structured-field dictionary, and this reads it member by
// member, as a cache does.
//
// No `node:` imports. This reads a string.

/**
 * The value of a member that is not there, or not a shape this reads.
 *
 * Two names for two outcomes: a missing key says nothing, an unreadable one has
 * to count as hiding.
 */
const ABSENT = Symbol('absent');
const UNREADABLE = Symbol('unreadable');

/**
 * Splits the header at the commas between members.
 *
 * A comma inside a quoted string or inside a list belongs to that member, so the
 * walk keeps track of both. A backslash in a quoted string escapes the next
 * character, which is how a string carries a quote.
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
      members.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  members.push(current.trim());
  return members.filter((member) => member !== '');
}

/**
 * The members by key. A key with no `=` is the boolean `true`, as the grammar
 * says. A repeated key keeps its last value, as the grammar also says.
 *
 * The key ends at `=` or at `;`, so a bare key with parameters, `params;x`, is
 * still `params`.
 *
 * @param {string} value
 * @returns {Map<string, string|true>}
 */
function readDictionary(value) {
  const dictionary = new Map();

  for (const member of splitMembers(value)) {
    const equals = member.indexOf('=');
    const semicolon = member.indexOf(';');
    const bare = equals === -1 || (semicolon !== -1 && semicolon < equals);

    if (bare) {
      const key = semicolon === -1 ? member : member.slice(0, semicolon);
      dictionary.set(key.trim(), true);
      continue;
    }

    const key = member.slice(0, equals).trim();
    const text = member.slice(equals + 1).trim();
    dictionary.set(key, text);
  }

  return dictionary;
}

/**
 * A boolean item without its parameters: `?1;x` is `?1`. Anything else is
 * returned as it was.
 *
 * @param {string} text
 * @returns {string}
 */
function withoutParameters(text) {
  if (text.startsWith('(')) return text;
  const semicolon = text.indexOf(';');
  return semicolon === -1 ? text : text.slice(0, semicolon).trim();
}

/**
 * The strings in an inner list, `("utm_source" "gclid")`, or `UNREADABLE`.
 *
 * Only quoted strings separated by spaces count. A token or a number is a shape
 * a cache might read some other way. After the closing parenthesis comes
 * nothing, or the list's parameters, `;x`, which say nothing here.
 *
 * @param {string} text
 * @returns {string[]|typeof UNREADABLE}
 */
function readStringList(text) {
  if (!text.startsWith('(')) return UNREADABLE;

  const strings = [];
  let i = 1;

  while (i < text.length) {
    if (text[i] === ' ') {
      i++;
      continue;
    }
    if (text[i] === ')') {
      const rest = text.slice(i + 1);
      return rest === '' || rest.startsWith(';') ? strings : UNREADABLE;
    }
    if (text[i] !== '"') return UNREADABLE;

    let string = '';
    let closed = false;
    i++;
    while (i < text.length) {
      const char = text[i];
      if (char === '\\') {
        string += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      i++;
      if (char === '"') {
        closed = true;
        break;
      }
      string += char;
    }
    if (!closed) return UNREADABLE;

    // Two strings with nothing between them are not a list.
    if (text[i] !== ' ' && text[i] !== ')') return UNREADABLE;
    strings.push(string);
  }

  // The list was never closed.
  return UNREADABLE;
}

/**
 * What `params` says: `true` ignores every parameter, `false` ignores none, and
 * a list ignores the parameters it names.
 *
 * @param {string|true|undefined} member
 * @returns {boolean|string[]|typeof ABSENT|typeof UNREADABLE}
 */
function readParams(member) {
  if (member === undefined) return ABSENT;
  if (member === true) return true;

  const text = withoutParameters(member);
  if (text === '?1') return true;
  if (text === '?0') return false;
  return readStringList(text);
}

/**
 * What `except` says: the parameters that still make a difference. A boolean
 * here is not a shape `except` takes.
 *
 * @param {string|true|undefined} member
 * @returns {string[]|typeof ABSENT|typeof UNREADABLE}
 */
function readExcept(member) {
  if (member === undefined) return ABSENT;
  if (member === true) return UNREADABLE;
  return readStringList(member);
}

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

  const dictionary = readDictionary(value);
  const params = readParams(dictionary.get('params'));
  const except = readExcept(dictionary.get('except'));

  if (params === UNREADABLE || except === UNREADABLE) return true;

  // An allowlist decides on its own: every parameter it leaves out is ignored.
  if (except !== ABSENT) return !except.includes(param);

  if (params === true) return true;
  if (Array.isArray(params)) return params.includes(param);
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
