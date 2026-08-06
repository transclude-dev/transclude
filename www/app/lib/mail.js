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

/**
 * Where the mail comes from, and where a reply goes.
 *
 * `MAIL_FROM` is a var in `wrangler.jsonc`, so changing it is one line and a
 * deploy rather than an edit here. Whatever it names, Resend has to hold a
 * verified domain for it: an address on a domain it cannot sign for is refused
 * at send time, not at deploy time.
 */
const from = () => bindings()?.MAIL_FROM ?? 'transclude <notes@transclude.dev>';

/** Replies reach a person, which the sending address does not have to. */
const replyTo = () => bindings()?.MAIL_REPLY_TO ?? null;

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
    body: JSON.stringify({
      from: from(),
      to: [email],
      ...(replyTo() ? { reply_to: replyTo() } : {}),
      ...confirmationMail(link),
    }),
  });

  if (res.ok) {
    // Resend answers with the id it filed the message under. Logged, because
    // "accepted" and "delivered" are different claims: a message it took and
    // then bounced looks exactly like one that arrived, and the id is the only
    // way to ask which happened.
    const { id } = await res.json().catch(() => ({}));
    console.log(`[subscribe] resend accepted ${email} as ${id ?? 'an unnamed message'}`);
    return { sent: true, id };
  }

  // The body carries Resend's reason, and it is the difference between a bad key
  // and a domain that is not verified yet.
  return { sent: false, reason: `${res.status} ${(await res.text()).slice(0, 200)}` };
}

/**
 * Adds a confirmed address to the audience the broadcasts go to.
 *
 * The split is the point. D1 says whether someone confirmed, and it is the
 * consent record. Resend says whether they still want it, because unsubscribing
 * happens in the footer of a message and never comes back through this site.
 * Neither mirrors the other, so there is one authority for each question.
 *
 * Which is why an address already known to Resend is left exactly as it is. A
 * contact who unsubscribed and later signs up again would otherwise be pushed
 * back in as subscribed, and re-subscribing someone who opted out is the one
 * mistake here with a legal shape.
 *
 * @param {string} email an address that has just confirmed
 * @returns {Promise<{ added: boolean, reason?: string }>}
 */
export async function addContact(email) {
  const env = bindings();
  const key = env?.RESEND_API_KEY;
  const audience = env?.RESEND_AUDIENCE_ID;

  if (!key || !audience) {
    console.log(`[confirm] no ${key ? 'RESEND_AUDIENCE_ID' : 'RESEND_API_KEY'}, so ${email} was not added`);
    return { added: false, reason: 'not configured' };
  }

  const base = `https://api.resend.com/audiences/${audience}/contacts`;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  // Asked before written. Resend's create would answer for an address it
  // already holds, and what it does with the unsubscribed flag is its business
  // rather than something to find out on a real person.
  const held = await fetch(`${base}/${encodeURIComponent(email)}`, { headers });
  if (held.ok) {
    console.log(`[confirm] resend already holds ${email}, left as it is`);
    return { added: false, reason: 'already a contact' };
  }

  const res = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, unsubscribed: false }),
  });

  if (!res.ok) {
    return { added: false, reason: `${res.status} ${(await res.text()).slice(0, 200)}` };
  }

  const { id } = await res.json().catch(() => ({}));
  console.log(`[confirm] resend added ${email} as ${id ?? 'an unnamed contact'}`);
  return { added: true };
}
