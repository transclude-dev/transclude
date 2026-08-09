// The user table, in memory, and the password check.
//
// Passwords are stored as a PBKDF2 hash with a per-user salt, through
// `crypto.subtle`, which every runtime this framework targets has. A real app
// reaches for a library and a higher cost; the shape is the same, and the point
// here is that a plain-text password never appears in the store.

const encoder = new TextEncoder();

// Low for a demo so the tests are quick. Real work starts around 600,000.
const ROUNDS = 10_000;

/**
 * @param {string} password
 * @param {string} salt
 * @returns {Promise<string>} the derived key, as hex
 */
export async function hash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: ROUNDS, hash: 'SHA-256' },
    key,
    256,
  );

  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** @type {{ id: number, email: string, name: string, salt: string, hash: string }[]} */
const users = [
  {
    id: 1,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    salt: 'ada-salt',
    // hash('correct horse', 'ada-salt'), computed once and pasted. A real store
    // holds exactly this: a salt and a derived key, never the password.
    hash: '',
  },
];

// Derived at startup here because the password is written in this file. In a
// real app the row already holds a hash, written when the account was made.
users[0].hash = await hash('correct horse', users[0].salt);

/**
 * The user, or null. Same answer and same work for an unknown email as for a
 * wrong password, so the timing does not say which one it was.
 *
 * @param {string} email
 * @param {string} password
 */
export async function signIn(email, password) {
  const user = users.find((row) => row.email === email.trim().toLowerCase());
  const salt = user?.salt ?? 'no-such-user';
  const attempt = await hash(password, salt);

  return user && attempt === user.hash ? user : null;
}

/**
 * The user an id names, for reading a session back.
 *
 * @param {string} id
 */
export const find = (id) => users.find((row) => String(row.id) === id) ?? null;

/**
 * The one thing in this demo that changes anything, so the one thing a guard
 * covering only the render would have let through.
 *
 * @param {string} id
 * @param {string} name
 */
export function rename(id, name) {
  const user = find(id);
  if (user) user.name = name;

  return user;
}
