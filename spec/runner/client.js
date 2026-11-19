// What a case's requests remember from one answer to the next, the way a
// browser does: cookies, the bodies it was sent, and the last ETag.
//
// One client per case run. `spec/runner/case.js` asks the app in its own
// process, and `spec/runtimes/` asks a server over HTTP. Both replay an
// `expect.json` the same way because both go through this.

/**
 * @typedef {{ headers?: Record<string, string | null>, form?: Record<string, string>,
 *   body?: string }} Send
 */

export function createClient() {
  // The cookies earlier answers set, by name. Every request sends them back.
  const jar = new Map();

  // Every body this case has been sent, in order. A request for a built asset
  // names it with `[hash]`, and the name is read back from these, the way a
  // browser follows a link the page gave it.
  const answers = [];

  // The ETag the last answer carried. A request that sends `[etag]` as a
  // header value sends this one back, the way a browser revalidates what it
  // holds. A validator made from a file's mtime changes with every build, so a
  // case cannot write it out.
  let lastEtag = null;

  /**
   * What a request sends besides its method and URL. A `form` goes the way a
   * browser posts one: form-encoded, with an `origin` that CSRF accepts. The
   * jar goes as `cookie`. `headers` are applied last, so a case can replace any
   * of these, a forged or an empty cookie included.
   *
   * @param {string} method
   * @param {Send} [send]
   * @returns {RequestInit & { headers: Headers }}
   */
  function initFor(method, send = {}) {
    const init = { method, redirect: 'manual', headers: new Headers() };
    if (send.form) {
      init.headers.set('origin', 'http://localhost');
      init.headers.set('content-type', 'application/x-www-form-urlencoded');
      init.body = new URLSearchParams(send.form).toString();
    }
    // Bytes, not a string: `Request` gives a string body `text/plain` on its
    // own, and a case may be about a body with no content type at all.
    if (send.body !== undefined) init.body = new TextEncoder().encode(send.body);
    if (jar.size) init.headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    for (const [name, value] of Object.entries(send.headers ?? {})) {
      // `null` takes a header away, so a case can send a form with no origin.
      if (value === null) init.headers.delete(name);
      else if (value === '[etag]') init.headers.set(name, lastEtag ?? '');
      else init.headers.set(name, value);
    }
    return init;
  }

  /**
   * A URL with `[hash]` in it, as an earlier answer named it:
   * `/assets/global-[hash].css` becomes `/assets/global-Cyt6b9Zw.css`. A URL
   * with no `[hash]` is returned as written, and one no answer names is `null`.
   *
   * @param {string} url
   */
  function assetUrl(url) {
    if (!url.includes('[hash]')) return url;
    const [before, after] = url.split('[hash]').map(literally);
    // Eight characters, the length `compare.js` counts as a hash.
    const pattern = new RegExp(`${before}[\\w-]{8}${after}`);
    for (const body of answers) {
      const found = body.match(pattern);
      if (found) return found[0];
    }
    return null;
  }

  /**
   * An answer, kept for the requests after it.
   *
   * @param {Headers} headers
   * @param {string} body
   */
  function remember(headers, body) {
    answers.push(body);
    lastEtag = headers.get('etag');
    keepCookies(jar, headers.getSetCookie());
  }

  return { initFor, assetUrl, remember };
}

/** Text as a regular expression that matches only that text. */
function literally(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Each `Set-Cookie` into the jar. One that has expired, by `Max-Age=0` or a
 * past `Expires`, takes the name out. Path and domain are not read: a case is
 * one host, and the paths in it are short.
 *
 * @param {Map<string, string>} jar
 * @param {string[]} setCookies
 */
function keepCookies(jar, setCookies) {
  for (const line of setCookies) {
    const [pair, ...attributes] = line.split(';').map((part) => part.trim());
    const at = pair.indexOf('=');
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (isExpired(attributes)) jar.delete(name);
    else jar.set(name, value);
  }
}

/** @param {string[]} attributes */
function isExpired(attributes) {
  for (const attribute of attributes) {
    const [key, value = ''] = attribute.split('=');
    const name = key.toLowerCase();
    if (name === 'max-age' && Number(value) <= 0) return true;
    if (name === 'expires' && Date.parse(value) <= Date.now()) return true;
  }
  return false;
}
