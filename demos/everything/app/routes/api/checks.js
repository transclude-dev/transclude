// Where /check?report sends its results.
//
// The checks in /check run in a browser and only a browser can answer them. In
// Chrome the answer is readable from the console. Safari needs "Allow remote
// automation" turned on by hand, and Firefox needs geckodriver, so neither can
// be driven here without setup. Posting the results back needs neither: open
// /check?report in any browser and the run appears in the server log.

/** @param {{ request: Request }} ctx */
export const POST = async ({ request }) => {
  const report = await request.json().catch(() => null);
  if (!report || typeof report !== 'object') {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const { agent = 'unknown', passed = 0, total = 0, failed = [], crash = null, moveBefore } = report;
  const mark = crash || passed !== total ? 'FAIL' : 'ok';
  const path = moveBefore === undefined ? '' : `  moveBefore: ${moveBefore}`;

  console.log(`\n[checks] ${mark}  ${passed}/${total}${path}  ${agent}`);
  if (crash) console.log(`  crashed: ${crash}`);
  for (const one of Array.isArray(failed) ? failed : []) {
    console.log(`  x ${one.name}\n    ${one.why}`);
  }

  return new Response(null, { status: 204 });
};
