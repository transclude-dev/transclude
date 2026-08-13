// Resolving the schemas a record actually reaches, and no others.
//
// The first version of this asked for every schema a lexicon *declares*.
// `app.bsky.feed.post` declares nine, and an ordinary post — text, langs, reply,
// createdAt — reaches exactly one of them. That was twenty-seven requests spent
// to use three, against other people's servers, on every cold render.
//
// It also had a hard ceiling behind it. Cloudflare's free plan allows fifty
// subrequests per request, and a lexicon page was measured at thirty-nine. Not a
// slow page: a page that stops working when somebody publishes a schema with a
// few more refs in it.
//
// So: render, see what the renderer wanted and could not find, fetch that, and
// render again. Repeat while it keeps finding new names.
//
// The renderer is not copied to do this. A second traversal that had to agree
// with `walk()` about which refs matter would be a second thing to keep in step,
// and it would drift the first time either changed. Instead `effective()` writes
// the names it missed into a set, and the loop below reads it. The pass that
// discovers is the same code as the pass that renders.

import { resolveMany } from './lexicon.js';
import { fieldsOf } from './render.js';

/**
 * How many times to look again. A ref can point at a def that points at another
 * document, so one pass is not always enough; three is past anything the field
 * walker will descend into, since it stops at depth three itself.
 */
const ROUNDS = 3;

/**
 * A record's fields, fetching schemas only as the record turns out to need them.
 *
 * @param {Record<string, any>} value  The record.
 * @param {object|null} def  `defs.main.record` from its own lexicon.
 * @param {import('./render.js').Ctx} base  `did`, `pds`, and `own`.
 * @param {import('./trace.js').Trace} trace
 * @returns {Promise<import('./render.js').Field[]>}
 */
export async function fieldsFor(value, def, base, trace) {
  /** @type {Record<string, object>} */
  let lexicons = {};

  // Every name already asked about, resolved or not. Without this, a schema
  // nobody published is asked for again on every round.
  const attempted = new Set();

  for (let round = 0; round < ROUNDS; round++) {
    /** @type {Set<string>} */
    const missing = new Set();
    const fields = fieldsOf(value, def, { ...base, lexicons, missing });

    const wanted = [...missing].filter((nsid) => !attempted.has(nsid));
    if (wanted.length === 0) return fields;

    for (const nsid of wanted) attempted.add(nsid);
    const found = await resolveMany(wanted, trace);

    // Nothing new to render with. What is on the page is what there is: the
    // fields are still all there, described by whatever was reachable.
    if (Object.keys(found).length === 0) return fields;

    lexicons = { ...lexicons, ...found };
  }

  return fieldsOf(value, def, { ...base, lexicons });
}
