// The words a reader is handed: American spelling, and `fragment` over `region`.
//
// It drifted in the ordinary way: a comment said one thing, the README built
// from it said another, and the docs page about it said a third. Nobody was
// wrong on purpose and nothing failed.
//
// The words live in `scripts/spelling.js`, which the Claude Code hook runs too,
// so the rule is written once. This walks every file git tracks rather than a
// list of directories: a repository-wide lint that happens to live in the test
// suite. It needs no app, so it does not cross the boundary the other tests
// keep.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parse } from 'acorn';

import { BRITISH, findings, reads } from '../scripts/spelling.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What to read: text this repository wrote, as git lists it. */
function ours() {
  const listed = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
  return listed.filter(reads);
}

test('there is something to read', () => {
  // A `git ls-files` that returns nothing passes every check below in silence.
  assert.ok(ours().length > 100, `only ${ours().length} files listed`);
});

test('every spelling is the American one', () => {
  const found = [];
  for (const file of ours()) {
    found.push(...findings(file, fs.readFileSync(path.join(root, file), 'utf8')));
  }

  assert.deepEqual(found, [], `British spellings, and this repository writes American:\n${found.join('\n')}`);
});

test('the list is pairs of two different words', () => {
  // A pair mapping a word to itself would refuse a spelling and then suggest the
  // same one, which reads as the lint being broken rather than the word being
  // wrong.
  const same = Object.entries(BRITISH).filter(([british, american]) => british === american);

  assert.deepEqual(same, []);
  assert.ok(Object.keys(BRITISH).length > 40, 'the list lost most of itself');
});

// ---- the reader's word for a fragment --------------------------------------

// `design/voice.md` spends its jargon on three words, and `fragment` is one of
// them. `region` is what the compiler calls the same thing inside itself, and
// the site has checked its own prose for the word since the day it leaked in
// there. That check says "only what a reader sees is checked", and then reads
// prose alone.
//
// A refusal is read too. Nine of them said `region`: a reader learned
// `fragment` from every page of the docs, wrote a bad one, and was told about a
// word the documentation does not contain. One of the nine was written while
// improving that very message, which is how quietly it spreads.
//
// Parsed, not grepped. `export const regions` is generated code that lives in a
// template literal, and `this.regions` is a field; both are names the compiler
// keeps for itself, and a search for the word counts them. Reading only what is
// handed to an Error says exactly the rule and nothing more.

/** Every string and template literal handed to a thrown Error, as text. */
function messages(code) {
  const out = [];
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const isError = node.type === 'NewExpression' && /Error$/.test(node.callee?.name ?? '');
    if (isError) out.push(...node.arguments.map((arg) => text(arg)));

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object' && value.type) walk(value);
    }
  };

  // A message is built with `+` and `${}`, so the pieces are gathered rather
  // than read off one node.
  const text = (node) => {
    if (!node) return '';
    if (node.type === 'Literal') return String(node.value ?? '');
    if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.raw).join(' ');
    if (node.type === 'BinaryExpression') return `${text(node.left)} ${text(node.right)}`;
    return '';
  };

  walk(ast);
  return out;
}

test('there are messages to read', () => {
  // An empty list passes the check below without looking at anything.
  const all = compilerSources().flatMap((file) =>
    messages(fs.readFileSync(path.join(root, file), 'utf8')),
  );

  assert.ok(all.length > 30, `only ${all.length} messages found`);
});

test('a refusal says fragment, never region', () => {
  const found = [];
  for (const file of compilerSources()) {
    for (const message of messages(fs.readFileSync(path.join(root, file), 'utf8'))) {
      if (/\bregions?\b/i.test(message)) found.push(`${file}: ${message.trim().slice(0, 70)}…`);
    }
  }

  assert.deepEqual(found, [], `refusals saying region:\n${found.join('\n')}`);
});

/** The files that refuse things, which is where a reader's sentences come from. */
function compilerSources() {
  const dir = path.join(root, 'src', 'compiler');
  const compiler = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  return [
    ...compiler.map((f) => path.join('src', 'compiler', f)),
    ...fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => path.join('src', f)),
  ];
}
