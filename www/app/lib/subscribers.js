// Reading and writing the list.
//
// One module so the routes never see SQL, and so dev and production differ in
// one place rather than in every handler. On workerd this is D1. Everywhere else
// there is no database at all, and the fallback is a Map that lives as long as
// the process: enough to click through the whole flow in `npm run dev`, and
// gone when you stop it.
//
// The fallback is deliberate and it is not a mock. A signup form that 500s in
// dev is a form nobody tests, and the alternative to this is remembering to run
// wrangler every time you want to look at the page.

import { bindings } from './bindings.js';

/** Dev and tests. Never reached on a runtime that has the binding. */
const memory = new Map();

/** The D1 database, or null when this is not running as a worker. */
const database = () => bindings()?.SUBSCRIBERS ?? null;

/**
 * A confirmation token.
 *
 * `crypto.getRandomValues` rather than `node:crypto`, because this file ends up
 * in the worker bundle. 32 bytes of base64url is long enough that guessing one
 * is not a way in.
 *
 * @returns {string}
 */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Whether this looks like an address worth storing.
 *
 * Deliberately loose. The real check is whether the confirmation mail arrives,
 * and a stricter pattern rejects valid addresses for no gain.
 *
 * @param {string} email
 * @returns {boolean}
 */
export const looksLikeEmail = (email) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email);

/**
 * Records a signup and returns its token.
 *
 * Upsert rather than insert, because someone signing up twice is someone who
 * lost the first mail. A fresh token is issued and the old link stops working,
 * which is what you want if the first one went astray.
 *
 * A confirmed address is left alone: re-signing up must not quietly move it
 * back to pending and stop their mail.
 *
 * @param {string} email
 * @param {string} source the path the form was on
 * @returns {Promise<{ token: string, already: boolean }>}
 */
export async function add(email, source) {
  const token = newToken();
  const now = Date.now();
  const db = database();

  if (!db) {
    const held = memory.get(email);
    if (held?.status === 'confirmed') return { token: held.token, already: true };
    memory.set(email, { email, status: 'pending', token, source, created_at: now });
    return { token, already: false };
  }

  const held = await db.prepare('select status, token from subscribers where email = ?').bind(email).first();
  if (held?.status === 'confirmed') return { token: held.token, already: true };

  await db
    .prepare(
      `insert into subscribers (email, status, token, source, created_at)
       values (?, 'pending', ?, ?, ?)
       on conflict(email) do update set token = excluded.token, source = excluded.source`,
    )
    .bind(email, token, source, now)
    .run();

  return { token, already: false };
}

/**
 * Confirms whoever holds this token.
 *
 * @param {string} token
 * @returns {Promise<string|null>} the address confirmed, or null for a token
 *   that is not one, has been used, or belongs to a signup that was replaced
 */
export async function confirm(token) {
  const now = Date.now();
  const db = database();

  if (!db) {
    for (const held of memory.values()) {
      // `status` as well as the token, matching the `where` below. Without it
      // this branch confirmed an already-confirmed address a second time while
      // the D1 branch did not, which is two backends disagreeing about the one
      // rule that matters here. The tests found it.
      if (held.token !== token || held.status !== 'pending') continue;
      held.status = 'confirmed';
      held.confirmed_at = now;
      return held.email;
    }
    return null;
  }

  // `returning` rather than a select and then an update: two statements would
  // let the same link confirm twice if it were clicked twice at once.
  const row = await db
    .prepare(
      `update subscribers set status = 'confirmed', confirmed_at = ?
       where token = ? and status = 'pending'
       returning email`,
    )
    .bind(now, token)
    .first();

  return row?.email ?? null;
}
