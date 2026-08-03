/**
 * Picks a content encoding from an Accept-Encoding header.
 *
 * Getting this wrong is not a missed optimisation, it is a corrupt response: a
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

function parse(header) {
  if (!header || !header.trim()) return null;

  const entries = new Map();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;

    let quality = 1;
    for (const param of params) {
      const [key, value] = param.split('=').map((s) => s.trim());
      if (key === 'q') {
        const parsed = Number.parseFloat(value);
        quality = Number.isFinite(parsed) ? parsed : 0;
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
