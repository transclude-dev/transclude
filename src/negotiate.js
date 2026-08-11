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
  return best?.encoding ?? null;
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

function read(header) {
  const entries = new Map();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;

    let quality = 1;
    for (const param of params) {
      const [key, value] = param.split('=').map((s) => s.trim());
      if (key === 'q') {
        const q = Number.parseFloat(value);
        quality = Number.isFinite(q) ? q : 0;
      }
    }
    entries.set(name.trim().toLowerCase(), quality);
  }
  return entries.size ? entries : null;
}

function qualityOf(accepted, encoding) {
  if (accepted.has(encoding)) return accepted.get(encoding);
  if (accepted.has('*')) return accepted.get('*');
  // identity is acceptable by default unless something above ruled it out.
  return encoding === 'identity' ? 1 : 0;
}
