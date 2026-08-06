// Sending the one message this site sends.
//
// Resend over `fetch`, not their SDK. The SDK is a dependency in the worker
// bundle for one POST, and the request is four lines.
//
// The order matters and it is deliberate. `subscribers.add` writes to D1 first,
// and this runs after. D1 is local to the worker and always up; a mail API is
// neither. If this fails, the address is still recorded and the mail can be
// sent again. If it were the other way round, a hiccup on launch day would lose
// the signup and nothing would say so.
//
// Nothing from `node:`.

import { bindings } from './bindings.js';

const ENDPOINT = 'https://api.resend.com/emails';

/** Where the mail comes from. A subdomain Resend was set up to sign for. */
const FROM = 'transclude <notes@transclude.dev>';

/**
 * The confirmation mail, as text and as markup.
 *
 * Short on purpose. It has one job and one link, and anything else in it is
 * something for a spam filter to weigh.
 *
 * @param {string} link
 * @returns {{ subject: string, text: string, html: string }}
 */
export function confirmationMail(link) {
  const subject = 'Confirm your subscription';

  const text = [
    'Someone asked to get occasional notes about transclude at this address.',
    '',
    'If it was you, confirm here:',
    link,
    '',
    'If it was not, ignore this. Nothing is sent to an address that has not',
    'confirmed, and this link expires the next time someone signs up with it.',
  ].join('\n');

  // Deliberately plain. No layout, no images, no tracking pixel: this is the
  // first thing a new subscriber sees, and it should look like a person sent it.
  const html = [
    '<p>Someone asked to get occasional notes about transclude at this address.</p>',
    `<p>If it was you, <a href="${link}">confirm here</a>.</p>`,
    '<p>If it was not, ignore this. Nothing is sent to an address that has not',
    'confirmed, and this link stops working the next time someone signs up with it.</p>',
    `<p><a href="${link}">${link}</a></p>`,
  ].join('\n');

  return { subject, text, html };
}

/**
 * Sends it, or says why it did not.
 *
 * Returns rather than throws, because the caller has already answered the
 * reader and a failure here changes nothing they can act on. The caller decides
 * whether to report it.
 *
 * @param {object} options
 * @param {string} options.email
 * @param {string} options.token
 * @param {string} options.origin the site the confirm link points back at
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendConfirmation({ email, token, origin }) {
  const key = bindings()?.RESEND_API_KEY;
  const link = `${origin}/confirm?token=${encodeURIComponent(token)}`;

  // Dev and tests. The link goes to the console, so the whole flow can be
  // clicked through locally without an API key and without sending anything.
  if (!key) {
    console.log(`[subscribe] no RESEND_API_KEY, so nothing was sent. Confirm at: ${link}`);
    return { sent: false, reason: 'no key' };
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], ...confirmationMail(link) }),
  });

  if (res.ok) return { sent: true };

  // The body carries Resend's reason, and it is the difference between a bad key
  // and a domain that is not verified yet.
  return { sent: false, reason: `${res.status} ${(await res.text()).slice(0, 200)}` };
}
