// The same request twice answers the same bytes.
//
// Each GET a case made is sent again, twice, exactly as it went the first
// time. The two answers must have the same status, the same headers and the
// same body.
//
// Nothing is put aside, because nothing in an answer is meant to change. The
// CSP is hashes, not a nonce, since a prerendered page is a file. A `Date`
// header is the server's to add, and `app.request()` is not a server. When a
// case finds something that is meant to change, it goes here, with the reason.

export const name = 'determinism';

/**
 * @param {import('../runner/invariants.js').Context} context
 * @returns {Promise<string[]>}
 */
export async function check({ exchanges, ask }) {
  const gets = exchanges.filter((answer) => answer.method === 'GET');
  const problems = [];
  for (const { url, init } of gets) {
    const first = await ask('GET', url, init);
    const second = await ask('GET', url, init);
    problems.push(...differ(url, first, second));
  }
  return problems;
}

/**
 * @param {string} url
 * @param {{ status: number, headers: Headers, body: string }} first
 * @param {{ status: number, headers: Headers, body: string }} second
 */
function differ(url, first, second) {
  const found = [];
  if (first.status !== second.status) found.push(`status ${first.status}, then ${second.status}`);
  const names = new Set([...first.headers.keys(), ...second.headers.keys()]);
  for (const header of [...names].sort()) {
    const one = first.headers.get(header);
    const two = second.headers.get(header);
    if (one !== two) found.push(`header ${header}: ${JSON.stringify(one)}, then ${JSON.stringify(two)}`);
  }
  if (first.body !== second.body) found.push('the body changed');
  return found.map((difference) => `GET ${url} twice: ${difference}`);
}
