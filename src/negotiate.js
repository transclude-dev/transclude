/**
 * Picks a content encoding from an Accept-Encoding header.
 *
 * Getting this wrong is not a missed optimization, it is a corrupt response: a
 * client that did not ask for brotli must never be handed brotli. So the rules
 * are followed properly: q-values, `*`, and `q=0` as a refusal.
 *
 * @param {string|null|undefined} header the request's Accept-Encoding
 * @param {string[]} available encodings this response actually has
 * @returns {string|null} null means send it unencoded
 */
export function pickEncoding(header, available = []) {
  if (!available.length) return null;

  const accepted = parse(header);
  // No header at all means the client stated no preference; sending identity is
  // the only safe reading of that.
  if (!accepted) return null;

  let best = null;
  for (const encoding of available) {
    const quality = qualityOf(accepted, encoding);
    if (quality <= 0) continue;
    if (!best || quality > best.quality) best = { encoding, quality };
  }
  if (!best) return null;

  // A client that weighs identity above the best encoding gets none. A tie goes
  // to the encoding: the client takes either, and the encoded body is smaller.
  if (statedIdentity(accepted) > best.quality) return null;
  return best.encoding;
}

/**
 * Whether an unencoded response is still allowed.
 *
 * A client can refuse identity with `identity;q=0`, and then a body we have no
 * encoding for cannot be sent at all.
 *
 * @param {string|null|undefined} header
 * @returns {boolean}
 */
export function identityAcceptable(header) {
  const accepted = parse(header);
  if (!accepted) return true;
  return qualityOf(accepted, 'identity') > 0;
}

/**
 * Parsed headers, keyed by the header itself.
 *
 * Every response negotiates, and clients send a handful of distinct
 * Accept-Encoding strings between them, so the same dozen values are parsed for
 * the life of the process. This was the largest piece of our own code in a
 * profile of the request path.
 *
 * The value is shared, so nothing may write to it. `qualityOf` only reads.
 */
const parsed = new Map();
const PARSED_MAX = 64;

function parse(header) {
  if (!header || !header.trim()) return null;

  const held = parsed.get(header);
  if (held !== undefined) return held;

  const answer = read(header);
  // A client can send anything, so the table is bounded. Oldest out first, which
  // is enough: the values that matter are sent by every request and go back in.
  if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value);
  parsed.set(header, answer);
  return answer;
}

/**
 * A weight as RFC 9110 writes it: `0` or `1`, with up to three decimals, and
 * nothing but zeros after a `1`. `.5`, `1.5` and `0.5x` are not weights.
 */
const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/** A weight that is not one counts as 0, so a coding written badly is refused. */
const weightOf = (text) => (QVALUE.test(text) ? Number(text) : 0);

/** Codings ignore case, and RFC 9110 says to read `x-gzip` as `gzip`. */
function codingOf(name) {
  const coding = name.trim().toLowerCase();
  return coding === 'x-gzip' ? 'gzip' : coding;
}

function read(header) {
  const entries = new Map();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    const coding = codingOf(name);
    if (!coding) continue;

    let quality = 1;
    for (const param of params) {
      const [key, value = ''] = param.split('=').map((s) => s.trim());
      // A parameter name ignores case, so `Q=0` refuses as `q=0` does.
      if (key.toLowerCase() === 'q') quality = weightOf(value);
    }

    // Named twice, the lower weight holds: a refusal anywhere is a refusal.
    const earlier = entries.get(coding) ?? quality;
    entries.set(coding, Math.min(earlier, quality));
  }
  return entries.size ? entries : null;
}

/**
 * The weight a client gave no encoding, when it gave one. Unlike `qualityOf`,
 * an identity the header never mentions is 0 here, so it outranks nothing.
 */
function statedIdentity(accepted) {
  if (accepted.has('identity')) return accepted.get('identity');
  if (accepted.has('*')) return accepted.get('*');
  return 0;
}

function qualityOf(accepted, encoding) {
  if (accepted.has(encoding)) return accepted.get(encoding);
  if (accepted.has('*')) return accepted.get('*');
  // identity is acceptable by default unless something above ruled it out.
  return encoding === 'identity' ? 1 : 0;
}
