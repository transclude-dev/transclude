// The invariants, run over each case once its own entries have been asked.
//
// An invariant is a property of every app, not of one. It reads what the case
// was answered and asks the app more. Each module in `spec/invariants/` exports
// a `name` and a `check` that returns its problems.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as determinism from '../invariants/determinism.js';
import * as fragmentEquivalence from '../invariants/fragment-equivalence.js';
import * as lightDom from '../invariants/light-dom.js';
import * as noClientJavaScript from '../invariants/no-client-javascript.js';
import * as unknownFragment from '../invariants/unknown-fragment.js';

const INVARIANTS = [fragmentEquivalence, unknownFragment, determinism, lightDom, noClientJavaScript];

/**
 * @typedef {{ status: number, headers: Headers, body: string }} Answer
 *
 * @typedef {object} Context
 * @property {string} caseDir the case's own directory, its source
 * @property {Record<string, any>} config the case's `transclude.config.js`
 * @property {string | null} fragmentParam the query parameter that asks for a
 *   fragment, from the case's config. `null` turns fragments off
 * @property {(Answer & { method: string, url: string, init: RequestInit })[]} exchanges
 *   each request the case's entries made, as it was sent, with what came back
 * @property {(method: string, url: string, init: RequestInit) => Promise<Answer>} ask
 *   one more request to the same app. It keeps no cookies and changes nothing
 *   the entries see
 */

/**
 * One result per invariant, in the shape an entry's result has, so the report
 * and the count read them the same way.
 *
 * A case may hold an `invariants.json` that names an invariant and says why it
 * does not hold there: `{ "determinism": "the loader counts its runs" }`. The
 * reason goes out as the result's `exempt`. The parent lets that result fail,
 * and fails it once it passes, so a reason nothing needs is not kept.
 *
 * @param {Omit<Context, 'config' | 'fragmentParam'> & { buildDir: string }} asked
 */
export async function checkInvariants({ buildDir, ...asked }) {
  const config = await configOf(buildDir);
  const context = { ...asked, config, fragmentParam: fragmentParamOf(config) };
  const exempt = exemptions(asked.caseDir);
  const results = [];
  for (const invariant of INVARIANTS) {
    const problems = await invariant.check(context);
    results.push({ request: `invariant: ${invariant.name}`, problems, exempt: exempt[invariant.name] ?? null });
  }
  // A misspelled name would exempt nothing and say nothing.
  const names = new Set(INVARIANTS.map((invariant) => invariant.name));
  const unknown = Object.keys(exempt).filter((key) => !names.has(key));
  if (unknown.length) results.push({ request: 'invariants.json', problems: unknown.map((key) => `no invariant is named "${key}"`) });
  return results;
}

/**
 * The case's config, as the build read it. The runner writes an empty one when
 * the case has none.
 *
 * @param {string} buildDir
 */
async function configOf(buildDir) {
  const file = pathToFileURL(path.join(buildDir, 'transclude.config.js')).href;
  const { default: config } = await import(file);
  return config;
}

/**
 * `fragmentParam` as the config sets it. `'fragment'` when the config leaves
 * it out, the default `/docs/config` gives.
 *
 * @param {Record<string, any>} config
 */
function fragmentParamOf(config) {
  return config.fragmentParam === undefined ? 'fragment' : config.fragmentParam;
}

/** @param {string} caseDir */
function exemptions(caseDir) {
  const file = path.join(caseDir, 'invariants.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
