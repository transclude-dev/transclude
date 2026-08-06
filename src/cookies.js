// Cookies, on the two things a loader already has: `ctx.request` to read and
// `ctx.response.headers` to write.
//
// The server has no built-in cookie API. `document.cookie` is the browser's, and
// on this side there is only a header to parse and a header to format. So this is
// the one place the framework has to supply something rather than point at the
// platform. The parsing and formatting are Hono's, which are already a dependency
// and already correct about encoding, `Max-Age`, and HMAC signing; what this adds
// is that an author never sees a router `Context` to use them.

import { parse, parseSigned, serialize, serializeSigned } from 'hono/utils/cookie';

/**
 * `set` appends rather than replaces: two cookies are two `Set-Cookie` headers,
 * and `Headers.set` would throw the first one away.
 *
 * `secret` comes from the config, which is the app's file, so where it comes from,
 * whether an env var or a secret manager, is the app's decision and not the
 * framework's. Without it, signing is an error rather than a silent downgrade to
 * unsigned, because a signature nobody checks is worse than none.
 *
 * @param {Request} request
 * @param {{ headers: Headers }} response the shared envelope
 * @param {string|null} [secret] without one, `signed` throws rather than writing unsigned
 * @returns {object} `get`, `set`, `delete`, `all`, `signed`, and the `personal` flag the cache reads
 */
export function cookiesOf(request, response, secret = null) {
  // Reading one is what makes a page personal, and a personal page must not be
  // held in a shared cache. Writing a header is not the whole test: a page that
  // only *reads* `mine` and renders a count sets nothing, and caching it would
  // hand one visitor's count to the next. So the read is what is recorded.
  let read = false;
  const header = () => {
    read = true;
    return request?.headers?.get('cookie') ?? '';
  };

  const write = (value) => response.headers.append('Set-Cookie', value);

  const requireSecret = (what) => {
    if (secret) return secret;

    // Set-but-empty is worth its own sentence. It happened on a real deploy:
    // `wrangler secret put` took a blank line, so the binding existed, every
    // `typeof` along the way said `string`, and the config carried it all the
    // way here. The only thing that said otherwise was the length. Reading
    // "needs a secret" while looking at a secret that is plainly set sends you
    // hunting through the wiring instead of the value.
    if (typeof secret === 'string') {
      throw new Error(
        `[transclude] ${what} needs a secret, and \`cookieSecret\` is set to an ` +
          `empty string. Whatever supplies it handed over nothing: on a worker that ` +
          `is usually a \`wrangler secret put\` that took a blank line`,
      );
    }

    throw new Error(
      `[transclude] ${what} needs a secret. Set \`cookieSecret\` in ` +
        `transclude.config.js (read it from the environment there, not from a literal)`,
    );
  };

  return {
    /** Whether anything asked what the request carried. Read by the cache. */
    get personal() {
      return read;
    },

    /** One cookie, or undefined. */
    get(name) {
      return parse(header(), name)[name];
    },

    /**
     * Every cookie the request carried.
     *
     * A null-prototype object, which is Hono's doing and worth keeping: a cookie
     * called `constructor` or `__proto__` is attacker-supplied input, and on a
     * plain object it would collide with something that already exists.
     */
    all() {
      return parse(header());
    },

    set(name, value, options = {}) {
      write(serialize(name, value, withDefaults(options, request)));
    },

    /**
     * Expiry in the past is how a cookie is removed. There is no delete verb.
     * The path has to match the one it was set with or the browser keeps it.
     */
    delete(name, options = {}) {
      write(serialize(name, '', { ...withDefaults(options, request), maxAge: 0, expires: new Date(0) }));
    },

    /**
     * Signed with HMAC, so the value is readable by the client but not
     * forgeable. That is what makes a cookie usable as a session: put an id in
     * it, keep the rest on the server.
     *
     * Async because verifying is a crypto operation. A tampered or unsigned
     * value reads as undefined rather than throwing. It is untrusted input, and
     * "no valid cookie" is the honest answer.
     *
     * Hono reports absent and present-but-forged differently: a missing name is a
     * missing key, a bad signature is `false`. Both mean the same thing here,
     * that there is nothing the caller can trust, and turning them into one value
     * is what keeps `?? fallback` doing what it looks like it does.
     */
    signed: {
      async get(name) {
        const parsed = await parseSigned(header(), requireSecret('reading a signed cookie'), name);
        return typeof parsed[name] === 'string' ? parsed[name] : undefined;
      },
      async all() {
        const parsed = await parseSigned(header(), requireSecret('reading a signed cookie'));
        return Object.fromEntries(
          Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
        );
      },
      async set(name, value, options = {}) {
        write(
          await serializeSigned(
            name,
            value,
            requireSecret('signing a cookie'),
            withDefaults(options, request),
          ),
        );
      },
    },
  };
}

/**
 * Whether this request arrived over TLS, so a cookie can say `Secure`.
 *
 * A proxy that terminates TLS forwards plain HTTP, so the request's own URL says
 * `http:` for a visitor who used `https:`. `X-Forwarded-Proto` is a header a
 * client can set, and trusting it here is safe in the only direction it can be
 * wrong: a lie turns `Secure` *on*, and a cookie that is then not sent over
 * plain HTTP fails closed. Nothing reads it to turn `Secure` off.
 *
 * @param {Request|null|undefined} request
 * @returns {boolean}
 */
function overTls(request) {
  const forwarded = request?.headers?.get('x-forwarded-proto') ?? '';
  if (forwarded.split(',')[0].trim().toLowerCase() === 'https') return true;

  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Defaults worth having rather than defaults the spec gives you. A cookie with
 * no `Path` is scoped to the current directory, which is almost never what was
 * meant; without `HttpOnly` a script can read a session id; and `SameSite=Lax`
 * is what stops it riding along on a cross-site request. That is the same hole
 * CSRF protection closes from the other side.
 *
 * `Secure` follows the connection rather than being always on, because always
 * on breaks `http://localhost` and an author who cannot keep a session in dev
 * turns the whole thing off. Set it yourself to override either way.
 */
function withDefaults(options, request) {
  return { path: '/', httpOnly: true, sameSite: 'Lax', secure: overTls(request), ...options };
}
