// A case's requests, sent over HTTP to a server on a port.
//
// The same requests `spec/runner/case.js` sends in process, made by the same
// client, so cookies, `[hash]` and `[etag]` work as they do there. `node:http`
// rather than `fetch`: `fetch` may not set `Host`, and it would undo a
// compressed body before anything could compare the bytes.

import http from 'node:http';
import { createClient } from '../runner/client.js';

/**
 * @typedef {{ request: string, status: number, headers: Headers, body: Buffer }} Answer
 */

const ANSWER_MS = 30_000;

/**
 * Each request, in order. Answers what each one was answered.
 *
 * @param {number} port
 * @param {{ request: string, send?: import('../runner/client.js').Send }[]} requests
 * @returns {Promise<Answer[]>}
 */
export async function replay(port, requests) {
  const client = createClient();
  const answers = [];
  for (const entry of requests) {
    const [method, written] = entry.request.split(' ');
    const url = client.assetUrl(written) ?? written;
    const answer = await ask(port, url, client.initFor(method, entry.send));
    client.remember(answer.headers, answer.body.toString('utf8'));
    answers.push({ request: entry.request, ...answer });
  }
  return answers;
}

/**
 * One request. `Host` is `localhost`, the host an in-process request names, so
 * an absolute URL the app writes reads the same here as in the spec.
 *
 * @param {number} port
 * @param {string} url
 * @param {RequestInit & { headers: Headers }} init
 * @returns {Promise<{ status: number, headers: Headers, body: Buffer }>}
 */
export function ask(port, url, init) {
  const headers = Object.fromEntries(init.headers);
  headers.host = 'localhost';
  const body = init.body === undefined ? null : Buffer.from(init.body);
  if (body) headers['content-length'] = String(body.length);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: url, method: init.method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: headersOf(res.rawHeaders), body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    // Long enough for wrangler, which takes a connection before workerd is up
    // and holds the request until it is. A server that never finishes an
    // answer is a failure, not a wait.
    request.setTimeout(ANSWER_MS, () => request.destroy(new Error(`${init.method} ${url}: no whole answer in ${ANSWER_MS / 1000} s`)));
    request.on('error', reject);
    request.end(body);
  });
}

/** @param {string[]} raw name, value, name, value, as the wire had them */
function headersOf(raw) {
  const headers = new Headers();
  for (let i = 0; i < raw.length; i += 2) headers.append(raw[i], raw[i + 1]);
  return headers;
}
