#!/usr/bin/env node
// `npm run check`. Type checks every .html file through TypeScript.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createChecker, positionAt } from '../src/typecheck.js';
import { emitTypes } from '../src/compiler/types.js';
import { loadProject } from '../src/project.js';
import { isMarkdown } from '../src/markdown.js';

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
// wrong. Parse what we just wrote, or a bad identifier ships silently.
//
// `skipLibCheck` has to be off, and it was on. This is a .d.ts, which is the one
// kind of file that flag skips, so the guard checked nothing at all: every
// project shipped a file naming `__Cookies` and declaring it nowhere. An editor
// missed it too, because a jsconfig.json implies the same flag.
//
// `types: []` keeps it to this file: whatever `@types` a project happens to have
// installed is not what is being checked here, and one of them failing to
// resolve its own dependency would read as our file being broken.
const emitted = ts.createProgram([types], {
  noEmit: true,
  skipLibCheck: false,
  types: [],
  target: ts.ScriptTarget.ESNext,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
});
const broken = [
  ...emitted.getSyntacticDiagnostics(),
  ...emitted.getSemanticDiagnostics(),
];
if (broken.length) {
  console.error(`\n${path.relative(root, types)} is not valid TypeScript:`);
  for (const diagnostic of broken.slice(0, 5)) {
    const at = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    console.error(
      `  ${at ? `line ${at.line + 1}: ` : ''}${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
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

  // What the checker measured, not what is on disk. They are the same file for
  // an `.html` page. For a Markdown page they are not, and reading disk here put
  // a caret under an unrelated word several lines from the mistake.
  const source = checker.sourceFor(file);
  const lines = source.split('\n');
  const relative = path.relative(root, file);
  const converted = isMarkdown(file);

  for (const diagnostic of diagnostics) {
    const { line, column } = positionAt(source, diagnostic.offset);
    if (diagnostic.severity === 'error') errors++;
    else warnings++;

    // Said plainly rather than left to be worked out. The line and column are
    // real, and they are not positions in the file the author opens.
    const where = converted ? `${relative}  (converted HTML, line ${line})` : `${relative}:${line}:${column + 1}`;
    console.log(`\n${where}  ${diagnostic.severity}  TS${diagnostic.code}`);
    console.log(`  ${diagnostic.message}`);

    const text = lines[line - 1] ?? '';
    const trimmed = text.replace(/^\s+/, '');
    const shift = text.length - trimmed.length;
    // The caret line is drawn under the trimmed source, so the column moves left
    // by however much indentation was cut. A run is capped so one long span does
    // not wrap the terminal.
    const pad = ' '.repeat(Math.max(0, column - shift));
    const run = '~'.repeat(Math.max(1, Math.min(diagnostic.length, 60)));

    console.log(`\n    ${trimmed}`);
    console.log(`    ${pad}${run}`);
  }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

if (errors + warnings) {
  console.log(`\n${plural(errors, 'error')}, ${plural(warnings, 'warning')} in ${files.length} files`);
} else {
  console.log(`\nNo type errors in ${files.length} files.`);
}

process.exitCode = errors ? 1 : 0;
