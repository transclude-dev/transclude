#!/usr/bin/env node
// Sends an issue of the newsletter.
//
//   npm run newsletter -- 001                    what would be sent, and nothing else
//   npm run newsletter -- 001 --test me@you.dev  one copy, to one address
//   npm run newsletter -- 001 --audience         the list
//
// Dry run unless told otherwise, and `--audience` is the only thing that mails
// anyone but you. Sending is a command rather than a consequence of deploying:
// a push should never be able to reach a subscriber.
//
// The message is a route. This fetches it rather than rendering it, so what
// goes out is what a browser would have shown, from one document with one data
// path. The subject and the preview line come out of the markup's own metadata,
// because `<title>` and `<meta name="description">` already mean exactly that.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { textFrom } from './newsletter-text.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const DATABASE = 'transclude-subscribers';

// Gmail clips a message past about this, and the unsubscribe link is at the
// bottom of every one of them.
const CLIP = 102 * 1024;

const die = (message) => {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
};

// ---- the arguments ---------------------------------------------------------

const args = process.argv.slice(2);
const issue = args.find((arg) => !arg.startsWith('--'));

const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? null);
};

if (!issue) {
  die(
    'Usage: npm run newsletter -- <issue> [--test <address>] [--audience] [--force]\n' +
      '\n' +
      '  npm run newsletter -- 001                     print what would be sent\n' +
      '  npm run newsletter -- 001 --test me@you.dev   one copy to one address\n' +
      '  npm run newsletter -- 001 --audience          the list',
  );
}

const testTo = value('test');
const toAudience = flag('audience');
const origin = value('origin') ?? 'https://transclude.dev';

// ---- what the message is ---------------------------------------------------

/**
 * The rendered issue, and the two pieces of metadata that become the subject
 * and the preview line.
 *
 * `?format=email` is the only difference from what a reader sees at that URL:
 * the unsubscribe link is the provider's token rather than the signup form.
 */
async function fetchIssue() {
  const url = `${origin}/newsletter/${issue}?format=email`;

  // Past any cache, and this is not belt and braces. The first dry run of this
  // reported a preview line that had been replaced minutes earlier, because the
  // edge still held the old render. A send script that can mail last week's copy
  // of an issue is worse than one that fails.
  const res = await fetch(`${url}&t=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });

  if (!res.ok) die(`${url} answered ${res.status}. Is the issue deployed?`);

  const html = await res.text();
  const subject = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  const preheader = html.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1]?.trim();

  if (!subject) die(`${url} has no <title>, which is where the subject comes from.`);

  return { url, html, subject, preheader, text: textFrom(html) };
}

// ---- what has already gone out ---------------------------------------------

/**
 * D1, through wrangler, because that is already how this database is reached
 * and a second way to talk to it is a second thing to keep true.
 */
function d1(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--json', '-y', '--command', sql],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // wrangler prints its banner before the JSON.
  const at = out.indexOf('[');
  return JSON.parse(out.slice(at))[0].results;
}

const alreadySent = () => d1(`select issue, sent_at from sends where issue = '${issue}'`)[0] ?? null;

const recordSend = (broadcastId, recipients) =>
  d1(
    `insert into sends (issue, broadcast_id, recipients, sent_at) values ` +
      `('${issue}', '${broadcastId ?? ''}', ${recipients ?? 0}, ${Date.now()})`,
  );

// ---- the provider ----------------------------------------------------------

const key = process.env.RESEND_API_KEY;
const audienceId = process.env.RESEND_AUDIENCE_ID ?? '7b197ded-d4d9-4e0e-b568-b49a28ea1b58';
const from = process.env.MAIL_FROM ?? 'transclude <notes@dakroub.co>';
const replyTo = process.env.MAIL_REPLY_TO ?? 'admin@dakroub.co';

async function resend(pathname, body) {
  const res = await fetch(`https://api.resend.com${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const answer = await res.json().catch(() => ({}));
  if (!res.ok) die(`Resend answered ${res.status}: ${JSON.stringify(answer)}`);

  return answer;
}

// ---- doing it --------------------------------------------------------------

const message = await fetchIssue();
const bytes = Buffer.byteLength(message.html);

process.stdout.write(
  [
    '',
    `  issue      ${issue}`,
    `  from       ${message.url}`,
    `  subject    ${message.subject}`,
    `  preview    ${message.preheader ?? '(none)'}`,
    `  html       ${(bytes / 1024).toFixed(1)} KB${bytes > CLIP ? '  ← past where Gmail clips' : ''}`,
    `  text       ${message.text.split('\n').length} lines`,
    '',
  ].join('\n'),
);

if (bytes > CLIP && !flag('force')) {
  die('Gmail clips a message this long, and the unsubscribe link is at the bottom. `--force` to send it anyway.');
}

if (!testTo && !toAudience) {
  const preview = path.join(root, `dist/newsletter-${issue}.txt`);
  fs.mkdirSync(path.dirname(preview), { recursive: true });
  fs.writeFileSync(preview, message.text);

  process.stdout.write(
    `  Dry run. The plain text is in ${path.relative(root, preview)}.\n` +
      `  --test <address> sends one copy. --audience sends the list.\n\n`,
  );
  process.exit(0);
}

// Before the key is looked for, because a send that already happened is not a
// credentials problem and should not be reported as one.
if (toAudience && !flag('force')) {
  const held = alreadySent();
  if (held) {
    const when = new Date(held.sent_at).toISOString();
    die(`Issue ${issue} was already sent, at ${when}. \`--force\` if you mean it.`);
  }
}

if (!key) {
  die(
    'No RESEND_API_KEY in the environment. It lives as a worker secret, so a send needs\n' +
      'it passed in: RESEND_API_KEY=… npm run newsletter -- ' + issue + ' --test you@example.dev',
  );
}

if (testTo) {
  const sent = await resend('/emails', {
    from,
    to: [testTo],
    reply_to: replyTo,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  process.stdout.write(`  Sent one copy to ${testTo}, filed as ${sent.id}.\n\n`);
  process.exit(0);
}

// --- the list ---------------------------------------------------------------

const broadcast = await resend('/broadcasts', {
  audience_id: audienceId,
  from,
  reply_to: replyTo,
  subject: message.subject,
  html: message.html,
  text: message.text,
});

await resend(`/broadcasts/${broadcast.id}/send`, {});
recordSend(broadcast.id, null);

process.stdout.write(`  Sent to the audience, filed as ${broadcast.id}.\n\n`);
