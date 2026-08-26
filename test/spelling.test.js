// American spelling, which `design/voice.md` asks for and nothing checked.
//
// It drifted in the ordinary way: one file said `colour` in a comment, the
// example built from it said `colours` in its README, and the docs page about it
// said `colors`. Nobody was wrong on purpose and nothing failed.
//
// Every file git tracks, rather than a directory list: a repo-wide lint that
// happens to live in the test suite. It needs no app, so it does not cross the
// boundary the other tests keep. What it skips is what nobody here wrote.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * British spellings this repository does not use, and the American one for each.
 *
 * Unambiguous ones only. `analyse` is here and `analysis` is not, because the
 * second is the same word in both and a guard that cries wolf is switched off.
 * A word whose British form is also a name or an API value stays out: GitHub's
 * own run status is `cancelled`, so the pattern below is anchored to prose by
 * being a whole word, and a JSON string reading `"cancelled"` is a comparison
 * with GitHub rather than a spelling of ours.
 */
const BRITISH = {
  colour: 'color',
  behaviour: 'behavior',
  favourite: 'favorite',
  honour: 'honor',
  neighbour: 'neighbor',
  flavour: 'flavor',
  armour: 'armor',
  humour: 'humor',
  labour: 'labor',
  rumour: 'rumor',
  vapour: 'vapor',
  centre: 'center',
  metre: 'meter',
  theatre: 'theater',
  fibre: 'fiber',
  grey: 'gray',
  draught: 'draft',
  labelled: 'labeled',
  cancelled: 'canceled',
  signalled: 'signaled',
  modelled: 'modeled',
  travelled: 'traveled',
  fuelled: 'fueled',
  catalogue: 'catalog',
  defence: 'defense',
  offence: 'offense',
  pretence: 'pretense',
  licence: 'license',
  practise: 'practice',
  analyse: 'analyze',
  organise: 'organize',
  organisation: 'organization',
  recognise: 'recognize',
  realise: 'realize',
  normalise: 'normalize',
  serialise: 'serialize',
  aluminium: 'aluminum',
  programme: 'program',
  storey: 'story',
  learnt: 'learned',
  spelt: 'spelled',
  judgement: 'judgment',
  acknowledgement: 'acknowledgment',
  artefact: 'artifact',
  sceptical: 'skeptical',
  speciality: 'specialty',
  whilst: 'while',
  amongst: 'among',
};

/**
 * Somebody else's bytes, files a script writes, and this file.
 *
 * A lockfile is the loudest of them: npm writes the name and description of
 * every dependency into it, and somebody else's package is called what they
 * called it. This file is the quietest: the words it refuses are written out in
 * it, so the first run after committing it failed on its own list.
 */
const NOT_OURS =
  /\.min\.js$|package-lock\.json$|^www\/app\/lib\/source\.js$|^test\/spelling\.test\.js$|^examples\/[^/]+\/app\/public\//;

/** What to read: text this repository wrote, as git lists it. */
function ours() {
  const listed = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');

  return listed
    .filter((file) => /\.(js|html|css|md|json|jsonc|yml|yaml|txt|svg)$/.test(file))
    .filter((file) => !NOT_OURS.test(file));
}

test('there is something to read', () => {
  // A `git ls-files` that returns nothing passes every check below in silence.
  assert.ok(ours().length > 100, `only ${ours().length} files listed`);
});

test('every spelling is the American one', () => {
  const pattern = new RegExp(`\\b(${Object.keys(BRITISH).join('|')})(s|d|es|ed|ing)?\\b`, 'gi');
  const found = [];

  for (const file of ours()) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');

    for (const match of source.matchAll(pattern)) {
      const [text, word] = match;
      // `match.index`, not a search for the text: the second `colour` in a file
      // is not the first one, and a line number that is always the first hit
      // sends the reader to the wrong place.
      const line = source.slice(0, match.index).split('\n').length;
      // The word as written, then the rule. Sticking the ending back on the
      // American stem would answer `centred` with `centerd`, and a lint that
      // suggests a misspelling is worse than one that suggests nothing.
      found.push(`${file}:${line}: ${text} (${word.toLowerCase()} -> ${BRITISH[word.toLowerCase()]})`);
    }
  }

  assert.deepEqual(found, [], `British spellings, and this repository writes American:\n${found.join('\n')}`);
});
