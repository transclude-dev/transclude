// Where /check?report sends its results.
//
// The checks in /check run in a browser and only a browser can answer them. In
// Chrome the answer is readable from the console. Safari needs "Allow remote
// automation" turned on by hand, and Firefox needs geckodriver, so neither can
// be driven here without setup. Posting the results back needs neither: open
// /check?report in any browser and the run appears in the server log.

// The last report this process received, so a driver can read the outcome
// rather than scrape a log. One slot, not a list: everything that reads this
// runs one browser at a time, and the newest run is the one that counts.
//
// Annotated, because `GET` reads it before `POST` assigns it, and TypeScript 7
// no longer infers an evolving type for a `let` a closure reads.
/** @type {null | { agent: string, passed: number, total: number,
 *   failed: Array<{ name: string, why: string }>, crash: string | null,
 *   moveBefore?: unknown }} */
let last = null;

/** The last report, or 204 while no browser has reported yet. */
export const GET = () => (last ? Response.json(last) : new Response(null, { status: 204 }));

/** @param {{ request: Request }} ctx */
export const POST = async ({ request }) => {
  const report = await request.json().catch(() => null);
  if (!report || typeof report !== 'object') {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const { agent = 'unknown', passed = 0, total = 0, failed = [], crash = null, moveBefore } = report;
  last = { agent, passed, total, failed: Array.isArray(failed) ? failed : [], crash, moveBefore };

  const mark = crash || passed !== total ? 'FAIL' : 'ok';
  const path = moveBefore === undefined ? '' : `  moveBefore: ${moveBefore}`;

  console.log(`\n[checks] ${mark}  ${passed}/${total}${path}  ${agent}`);
  if (crash) console.log(`  crashed: ${crash}`);
  for (const one of last.failed) {
    console.log(`  x ${one.name}\n    ${one.why}`);
  }

  return new Response(null, { status: 204 });
};
