#!/usr/bin/env node
// `npm run check`. Type checks every .html file through TypeScript.

import fs from 'node:fs';
import path from 'node:path';
import { emitTypes } from '../src/compiler/types.js';
import { loadProject } from '../src/project.js';
import { isMarkdown } from '../src/markdown.js';
import { reportFor, summarize } from '../src/diagnostics.js';

// `typescript` is an optional peer: this is the one command that drives it, and
// a project that never runs it does not need the install. That makes a missing
// TypeScript a normal state rather than a broken one, and the resolver's own
// words for it name a package the author never wrote. Loaded here rather than
// imported at the top because a static import is hoisted above any guard.
const { checkAlone, createChecker, positionAt } = await import('../src/typecheck.js').catch(
  (err) => {
    const missing =
      err?.code === 'ERR_MODULE_NOT_FOUND' && /'typescript(\/|')/.test(err.message ?? '');
    if (!missing) throw err;

    console.error(
      '[transclude] transclude-check drives TypeScript 7, and this project does not have it.\n' +
        '  Install it: npm install -D typescript@7',
    );
    process.exit(1);
  },
);

const { root, config } = await loadProject();
const checker = createChecker({ root, ...config });

// transclude-env.d.ts is an output, not an input: the shims are self-contained, so the
// types can be written from what tsc made of them rather than the other way
// round. Nothing downstream reads it. It exists for the author and the editor.
const types = path.join(root, config.typesFile);
const next = emitTypes(checker.describe());
if (!fs.existsSync(types) || fs.readFileSync(types, 'utf8') !== next) {
  fs.writeFileSync(types, next);
  console.log(`wrote ${path.relative(root, types)}`);
}

// Nothing downstream reads this file, so nothing else would notice it being
// wrong. Parse what we just wrote, or a bad identifier ships silently. The
// guard itself lives in `checkAlone`, where the reasons for its options are,
// and where `test/types.test.js` reads the same answers.
const broken = checkAlone(types);
if (broken.length) {
  console.error(`\n${path.relative(root, types)} is not valid TypeScript:`);
  for (const diagnostic of broken.slice(0, 5)) {
    const at = positionAt(next, diagnostic.offset);
    console.error(`  line ${at.line}: ${diagnostic.message}`);
  }
  if (broken.length > 5) console.error(`  …and ${broken.length - 5} more`);
  process.exit(1);
}
const files = checker.files();

let errors = 0;
let warnings = 0;

for (const file of files) {
  const diagnostics = checker.check(file);
  if (!diagnostics.length) continue;

  const report = reportFor(file, diagnostics, {
    root,
    source: checker.sourceFor(file),
    converted: isMarkdown(file),
    positionAt,
  });
  errors += report.errors;
  warnings += report.warnings;
  console.log(report.lines.join('\n'));
}

// The compiler is a child process. Closed here, or the exit waits on it.
checker.dispose();

console.log(`\n${summarize({ errors, warnings, files: files.length })}`);

process.exitCode = errors ? 1 : 0;
