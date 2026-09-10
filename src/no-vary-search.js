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
// No `node:` imports. This reads a string.

/** `params=(…)` or `except=(…)`, with the quoted names inside. */
const LIST = /(?:^|,)\s*(params|except)\s*=\s*\(([^)]*)\)/;

/** `params` on its own, which is the structured-fields way to say every one. */
const EVERY = /(?:^|,)\s*params\s*(?:=\s*\?1\s*)?(?=,|$)/;

/** A key that takes a list, written without one this can read. */
const UNREADABLE = /(?:^|,)\s*(?:params|except)\s*=/;

const namesIn = (list) => [...list.matchAll(/"([^"]*)"/g)].map(([, name]) => name);

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
  if (!value || !value.trim() || !param) return false;

  const listed = LIST.exec(value);
  if (listed) {
    const [, key, list] = listed;
    const names = namesIn(list);
    return key === 'except' ? !names.includes(param) : names.includes(param);
  }

  if (EVERY.test(value)) return true;

  return UNREADABLE.test(value);
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
