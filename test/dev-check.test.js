// The dev server's background type check.
//
// The reporter is tested against a fake checker rather than a real one, because
// what is worth checking here is the scheduling: a burst of saves has to run
// once, a save during a run has to queue exactly one more, and a file added
// during a coalesced burst must not lose its rebuild. None of that involves
// TypeScript.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadTypecheck, typeReporter } from '../src/dev-check.js';
import { reportFor, summarize } from '../src/diagnostics.js';

/** A checker that answers from a script, and counts what it was asked. */
function fakeChecker({ files = ['/app/routes/index.html'], diagnostics = {} } = {}) {
  const calls = { checks: [], rebuilds: 0, passes: 0 };
  return {
    calls,
    files() {
      calls.passes++;
      return files;
    },
    check(file) {
      calls.checks.push(file);
      return diagnostics[file] ?? [];
    },
    sourceFor: () => 'const wrong = nope.missing;\n',
    rebuild() {
      calls.rebuilds++;
    },
  };
}

const positionAt = () => ({ line: 1, column: 14 });
const isMarkdown = () => false;

const reporterOn = (checker, lines, delay = 5) =>
  typeReporter({
    checker,
    root: '/app',
    positionAt,
    isMarkdown,
    log: (line) => lines.push(line),
    delay,
  });

// ---- what it says ----------------------------------------------------------

test('a clean run says so, because silence is what a run that never happened looks like', async () => {
  // `/blog/no-output-looks-like-good-output`. A checker that prints only on
  // failure makes "passed" and "never ran" the same output.
  const lines = [];
  await reporterOn(fakeChecker(), lines).run();

  assert.deepEqual(lines, ['[types] No type errors in 1 files.']);
});

test('a diagnostic is printed, and then counted', async () => {
  const lines = [];
  const checker = fakeChecker({
    diagnostics: {
      '/app/routes/index.html': [
        { offset: 20, length: 4, message: "Cannot find name 'nope'.", code: 2304, severity: 'error' },
      ],
    },
  });

  await reporterOn(checker, lines).run();

  assert.match(lines[0], /routes\/index\.html:1:15\s+error\s+TS2304/);
  assert.match(lines[0], /Cannot find name 'nope'\./);
  assert.equal(lines[1], '[types] 1 error, 0 warnings in 1 files');
});

// ---- scheduling ------------------------------------------------------------

test('a burst of saves runs once', async () => {
  const lines = [];
  const checker = fakeChecker();
  const reporter = reporterOn(checker, lines);

  reporter.schedule();
  reporter.schedule();
  reporter.schedule();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(checker.calls.passes, 1, 'three saves ran the checker more than once');
});

test('a save during a run queues exactly one more', async () => {
  const lines = [];
  const checker = fakeChecker({ files: ['/app/a.html', '/app/b.html'] });
  const reporter = reporterOn(checker, lines);

  const running = reporter.run();
  // Mid-pass, because the reporter yields between files.
  reporter.schedule();
  reporter.schedule();
  await running;

  assert.equal(checker.calls.passes, 2, 'the queued run was lost or doubled');
});

test('a rebuild asked for during a burst is not lost', async () => {
  // Adding a file and then editing it is two events. The add is the one that
  // changes what every other page's type can see, and the edit must not drop it.
  const lines = [];
  const checker = fakeChecker();
  const reporter = reporterOn(checker, lines);

  reporter.schedule({ rebuild: true });
  reporter.schedule({ rebuild: false });
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(checker.calls.rebuilds, 1);
  assert.equal(checker.calls.passes, 1);
});

test('a rebuild happens once, not on every pass after it', async () => {
  const lines = [];
  const checker = fakeChecker();
  const reporter = reporterOn(checker, lines);

  await reporter.run();
  reporter.schedule({ rebuild: true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  reporter.schedule();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(checker.calls.rebuilds, 1);
  assert.equal(checker.calls.passes, 3);
});

test('a checker that throws is reported rather than left to an unhandled rejection', async () => {
  const lines = [];
  const reporter = reporterOn(
    { files: () => ['/app/a.html'], check: () => { throw new Error('the compiler died'); },
      sourceFor: () => '', rebuild() {} },
    lines,
  );

  reporter.schedule();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.deepEqual(lines, ['[types] the compiler died']);
});

test('it yields between files, so one slow file does not sit in front of a request', async () => {
  const checker = fakeChecker({ files: ['/app/a.html', '/app/b.html', '/app/c.html'] });
  const reporter = reporterOn(checker, []);

  let ticks = 0;
  const tick = () => {
    ticks++;
    if (ticks < 10) Promise.resolve().then(tick);
  };
  Promise.resolve().then(tick);
  await reporter.run();

  assert.ok(ticks > 0, 'the pass never gave the loop back');
});

// ---- the optional peer -----------------------------------------------------

test('the checker loads here, because this repository has TypeScript', async () => {
  const loaded = await loadTypecheck();

  assert.equal(typeof loaded?.createChecker, 'function');
  assert.equal(typeof loaded?.positionAt, 'function');
});

// ---- the shared reporter ---------------------------------------------------
//
// `bin/check.js` and the dev server both print through these, so the format is
// one thing rather than two that have to stay identical.

test('a Markdown page says the line is in the converted HTML', () => {
  // An offset from a shim built out of converted HTML, printed against the
  // Markdown, points at the wrong column and looks authoritative doing it.
  const { lines } = reportFor(
    '/app/routes/post.md',
    [{ offset: 0, length: 3, message: 'nope', code: 1, severity: 'error' }],
    { root: '/app', source: 'abc\n', converted: true, positionAt },
  );

  assert.match(lines.join('\n'), /routes\/post\.md {2}\(converted HTML, line 1\)/);
});

test('the caret moves left by whatever indentation was cut', () => {
  const { lines } = reportFor(
    '/app/a.html',
    [{ offset: 0, length: 4, message: 'nope', code: 1, severity: 'error' }],
    { root: '/app', source: '        const wrong = 1;\n', positionAt: () => ({ line: 1, column: 14 }) },
  );

  const source = lines.findIndex((line) => line.includes('const wrong'));
  // Six columns in, not fourteen: eight spaces of indentation came off the line
  // above it.
  assert.equal(lines[source + 1], `    ${' '.repeat(6)}~~~~`);
});

test('a long span is capped so it does not wrap the terminal', () => {
  const { lines } = reportFor(
    '/app/a.html',
    [{ offset: 0, length: 500, message: 'nope', code: 1, severity: 'error' }],
    { root: '/app', source: 'x\n', positionAt: () => ({ line: 1, column: 0 }) },
  );

  assert.equal(lines[lines.length - 1].trim().length, 60);
});

test('a zero-length span still draws one mark', () => {
  const { lines } = reportFor(
    '/app/a.html',
    [{ offset: 0, length: 0, message: 'nope', code: 1, severity: 'error' }],
    { root: '/app', source: 'x\n', positionAt: () => ({ line: 1, column: 0 }) },
  );

  assert.equal(lines[lines.length - 1].trim(), '~');
});

test('warnings and errors are counted apart', () => {
  const { errors, warnings } = reportFor(
    '/app/a.html',
    [
      { offset: 0, length: 1, message: 'a', code: 1, severity: 'error' },
      { offset: 0, length: 1, message: 'b', code: 2, severity: 'warning' },
      { offset: 0, length: 1, message: 'c', code: 3, severity: 'warning' },
    ],
    { root: '/app', source: 'x\n', positionAt: () => ({ line: 1, column: 0 }) },
  );

  assert.deepEqual({ errors, warnings }, { errors: 1, warnings: 2 });
});

test('the summary counts one error as an error', () => {
  assert.equal(summarize({ errors: 0, warnings: 0, files: 22 }), 'No type errors in 22 files.');
  assert.equal(summarize({ errors: 1, warnings: 0, files: 22 }), '1 error, 0 warnings in 22 files');
  assert.equal(summarize({ errors: 2, warnings: 1, files: 22 }), '2 errors, 1 warning in 22 files');
});
