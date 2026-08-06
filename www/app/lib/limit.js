// How often one address on the internet may post the signup form.
//
// Cloudflare's rate limiter rather than Turnstile, and the reason is the page it
// sits on. Turnstile is a script: adding it would make this form need JavaScript
// to submit, on a site whose landing page says it ships none and whose whole
// argument is that a form is enough. This runs at the edge, before the loader,
// and the markup does not change.
//
// What it protects is the send. Double opt-in means anyone hammering the form
// makes us mail strangers on their behalf, which costs quota and reputation
// rather than correctness. The honeypot in the form catches whatever reads
// markup; this catches whatever does not bother to.

import { bindings } from './bindings.js';

/**
 * Whether this request may go on.
 *
 * Open when there is no limiter, which is dev, every test, and any runtime that
 * is not workerd. A local form that refuses to submit teaches nothing.
 *
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function withinLimit(request) {
  const limiter = bindings()?.SIGNUP_LIMIT;
  if (!limiter) return true;

  // Cloudflare's own header, which is the real client address. `X-Forwarded-For`
  // arrives from the client and can say anything.
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return true;

  const { success } = await limiter.limit({ key: ip });
  if (!success) console.log(`[subscribe] rate limited ${ip}`);

  return success;
}
