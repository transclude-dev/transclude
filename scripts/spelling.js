#!/usr/bin/env node
// American spelling, which `design/voice.md` asks for.
//
// One list, read by two callers. `test/spelling.test.js` walks everything git
// tracks, which is the gate CI and a release run through. Claude Code runs this
// file as a hook after every write, which is the same rule one round trip
// earlier: the file is refused before it can reach a commit.
//
// The two used to be one list in the test, and the hook would have been a second
// copy of it. Two lists of the same words drift, and the one nobody edits is the
// one that keeps passing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * British spellings this repository does not use, and the American one for each.
 *
 * Unambiguous words only. `analyse` is here and its noun is not, because they
 * are the same word in both and a guard that cries wolf is a guard somebody
 * switches off. A word whose British form is also an API value stays out:
 * GitHub's own run status is spelled the British way, and a workflow comparing
 * against it is quoting GitHub rather than writing English.
 */
export const BRITISH = {
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

/** Text this repository wrote, by extension. */
const TEXT = /\.(js|html|css|md|json|jsonc|yml|yaml|txt|svg)$/;

/**
 * What nobody here wrote, plus the two files that hold the list itself.
 *
 * A lockfile is the loudest of them: npm records the name and description of
 * every dependency in it, and somebody else's package is called what they called
 * it. Both exclusions past that were found by running this rather than by
 * thinking about it: the lockfile on the first pass, and this file on the pass
 * after it was committed.
 */
const NOT_OURS =
  /\.min\.js$|package-lock\.json$|^www\/app\/lib\/source\.js$|^scripts\/spelling\.js$|^test\/spelling\.test\.js$|^examples\/[^/]+\/app\/public\//;

/**
 * Whether this path is one to read at all.
 *
 * @param {string} file repository-relative
 * @returns {boolean}
 */
export const reads = (file) => TEXT.test(file) && !NOT_OURS.test(file);

const PATTERN = new RegExp(`\\b(${Object.keys(BRITISH).join('|')})(s|d|es|ed|ing)?\\b`, 'gi');

/**
 * Every British spelling in this source, as a line somebody can act on.
 *
 * The word as written comes first, then the rule. Sticking the ending back on
 * the American stem would answer `centred` with `centerd`, and a lint that
 * suggests a misspelling is worse than one that suggests nothing.
 *
 * @param {string} file for the message
 * @param {string} source
 * @returns {string[]}
 */
export function findings(file, source) {
  const found = [];

  for (const match of source.matchAll(PATTERN)) {
    const [text, word] = match;
    // `match.index`, not a search for the text: the second `colour` in a file is
    // not the first one, and a line number that always names the first hit sends
    // the reader to the wrong place.
    const line = source.slice(0, match.index).split('\n').length;
    found.push(`${file}:${line}: ${text} (${word.toLowerCase()} -> ${BRITISH[word.toLowerCase()]})`);
  }
  return found;
}

// ---- the hook -------------------------------------------------------------
//
// `node scripts/spelling.js --hook`, with Claude Code's PostToolUse payload on
// stdin. Exit 2 is what makes the agent read the message and fix the file; every
// other outcome here is exit 0, because a hook that fails on its own is a hook
// that blocks every edit.

const runDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runDirectly) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  let payload = '';
  for await (const chunk of process.stdin) payload += chunk;

  try {
    const file = JSON.parse(payload || '{}').tool_input?.file_path;
    const relative = file && path.relative(root, path.resolve(root, file));

    if (relative && reads(relative) && fs.existsSync(file)) {
      const found = findings(relative, fs.readFileSync(file, 'utf8'));
      if (found.length) {
        process.stderr.write(
          `British spellings in what you just wrote. This repository writes American:\n${found.join('\n')}\n`,
        );
        process.exit(2);
      }
    }
  } catch {
    // A payload this could not read is not the author's mistake.
  }
}
