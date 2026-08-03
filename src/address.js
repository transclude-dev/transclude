// Which addresses a server may be asked to fetch from.
//
// A server that fetches a URL somebody sent it can be pointed at things only it
// can reach: another service on the same host, a database on the private
// network, or the cloud metadata endpoint that hands out credentials. Refusing
// those is the whole job here.
//
// No `node:` imports and no DNS. This decides what an address means; resolving
// a name to one is the runtime's job, and one of the four runtimes cannot do it
// at all.

/**
 * Ranges that are not the public internet, as [test, why].
 *
 * @type {Array<[(a: number[]) => boolean, string]>}
 */
const V4_BLOCKED = [
  [(a) => a[0] === 0, 'this network'],
  [(a) => a[0] === 10, 'private'],
  [(a) => a[0] === 127, 'loopback'],
  [(a) => a[0] === 100 && a[1] >= 64 && a[1] <= 127, 'carrier-grade NAT'],
  [(a) => a[0] === 169 && a[1] === 254, 'link-local, and the metadata endpoint'],
  [(a) => a[0] === 172 && a[1] >= 16 && a[1] <= 31, 'private'],
  [(a) => a[0] === 192 && a[1] === 0 && a[2] === 0, 'protocol assignments'],
  [(a) => a[0] === 192 && a[1] === 168, 'private'],
  [(a) => a[0] === 198 && (a[1] === 18 || a[1] === 19), 'benchmarking'],
  [(a) => a[0] >= 224, 'multicast or reserved'],
];

/**
 * An IPv4 address as four numbers, or null if the text is not one.
 *
 * @param {string} text
 * @returns {number[]|null} four octets, or null when it is not one
 */
export function parseV4(text) {
  const parts = text.split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    return Number(part);
  });
  if (octets.some((n) => Number.isNaN(n) || n > 255)) return null;
  return octets;
}

/**
 * An IPv6 address as eight groups, or null.
 *
 * Only enough of the format to classify one. An address with a trailing IPv4
 * part is handled, because `::ffff:169.254.169.254` is the obvious way around a
 * checker that only reads the hex form.
 *
 * @param {string} text
 * @returns {number[]|null} sixteen bytes, or null
 */
export function parseV6(text) {
  let body = text;
  let tail = null;

  const dotted = body.lastIndexOf(':');
  if (body.slice(dotted + 1).includes('.')) {
    tail = parseV4(body.slice(dotted + 1));
    if (!tail) return null;
    body = body.slice(0, dotted + 1) + '0:0';
  }

  const halves = body.split('::');
  if (halves.length > 2) return null;

  const read = (part) =>
    part === '' ? [] : part.split(':').map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));

  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;

  let groups;
  if (halves.length === 2) {
    const gap = 8 - head.length - rest.length;
    if (gap < 0) return null;
    groups = [...head, ...Array(gap).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  if (tail) {
    groups[6] = (tail[0] << 8) | tail[1];
    groups[7] = (tail[2] << 8) | tail[3];
  }
  return groups;
}

/**
 * Why this address may not be fetched from, or null if it may.
 *
 * Takes the text of a host, with no brackets. A name that is not an address
 * returns null: whether a *name* is allowed is the allowlist's question, and
 * where it resolves to is the runtime's.
 *
 * @param {string} host a literal address, not a name
 * @returns {string|null} why it is refused, or null when it is allowed
 */
export function blockedAddress(host) {
  const v4 = parseV4(host);
  if (v4) {
    for (const [test, why] of V4_BLOCKED) if (test(v4)) return why;
    return null;
  }

  const v6 = parseV6(host);
  if (!v6) return null;

  const [a, b] = v6;
  if (v6.every((g) => g === 0)) return 'unspecified';
  if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return 'loopback';
  // An IPv4 address wearing an IPv6 hat. `::ffff:10.0.0.1` reaches the same
  // host `10.0.0.1` does.
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    const mapped = [v6[6] >> 8, v6[6] & 255, v6[7] >> 8, v6[7] & 255];
    for (const [test, why] of V4_BLOCKED) if (test(mapped)) return `${why}, through an IPv4-mapped address`;
    return null;
  }
  if ((a & 0xfe00) === 0xfc00) return 'unique local';
  if ((a & 0xffc0) === 0xfe80) return 'link-local';
  if (a === 0x2001 && b === 0x0db8) return 'documentation';
  return null;
}

/**
 * Whether a hostname is one the config named.
 *
 * Default deny. An entry is an exact hostname, or `*.example.com`, which covers
 * any subdomain but not the bare domain: naming a wildcard should not quietly
 * hand over the apex too.
 *
 * @param {string} host
 * @param {string[]} [allow] names, and `*.` wildcards
 * @returns {boolean} false unless something on the list names it
 */
export function allowedHost(host, allow = []) {
  const name = String(host).toLowerCase().replace(/\.$/, '');

  return allow.some((entry) => {
    const rule = String(entry).toLowerCase().replace(/\.$/, '');
    if (rule.startsWith('*.')) return name.endsWith(rule.slice(1)) && name !== rule.slice(2);
    return name === rule;
  });
}

/**
 * The one place a URL is judged before anything connects.
 *
 * Order matters. The allowlist is checked before the address, so a host nobody
 * permitted is refused without this having formed an opinion about where it
 * points.
 *
 * @param {string} url
 * @param {{ allow?: string[] }} [options]
 * @returns {{ ok: boolean, reason?: string, url?: URL }}
 */
export function checkUrl(url, { allow = [] } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a URL';
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `${parsed.protocol} is not a scheme this fetches`;
  }
  if (parsed.username || parsed.password) return 'credentials in a URL are not passed on';
  if (!allowedHost(parsed.hostname, allow)) return `${parsed.hostname} is not an allowed host`;

  // Brackets are the URL syntax for a v6 host and are not part of the address.
  const blocked = blockedAddress(parsed.hostname.replace(/^\[|\]$/g, ''));
  if (blocked) return `${parsed.hostname} is ${blocked}`;

  return null;
}
