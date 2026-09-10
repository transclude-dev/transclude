// A type diagnostic, printed.
//
// Two commands print these: `transclude-check`, which is the whole point of
// that command, and the dev server, which reports in the background so a type
// error is something you hear about before you run the check. Two copies of a
// caret line is two things to keep identical, and a diagnostic that reads one
// way in dev and another in CI is worse than either.
//
// Lines out rather than `console.log` in, so a test reads strings.

import path from 'node:path';

/**
 * One diagnostic, as the checker answers it.
 *
 * `file` rides along because `check` answers for one file at a time and the
 * caller already knows which. Nothing here reads it.
 *
 * @typedef {{ offset: number, length: number, message: string, code: number,
 *   severity: string, file?: string }} Diagnostic
 */

/**
 * One file's diagnostics as the lines to print.
 *
 * `source` is what the checker measured, never what is on disk. They are the
 * same file for an `.html` page. For a Markdown page they are not, and reading
 * disk here put a caret under an unrelated word several lines from the mistake.
 *
 * @param {string} file the absolute path
 * @param {Diagnostic[]} diagnostics what `checker.check` answered
 * @param {{ root: string, source: string, converted?: boolean,
 *   positionAt: (source: string, offset: number) => { line: number, column: number } }} at
 * @returns {{ lines: string[], errors: number, warnings: number }}
 */
export function reportFor(file, diagnostics, { root, source, converted = false, positionAt }) {
  const lines = [];
  let errors = 0;
  let warnings = 0;

  const text = source.split('\n');
  const relative = path.relative(root, file);

  for (const diagnostic of diagnostics) {
    const { line, column } = positionAt(source, diagnostic.offset);
    if (diagnostic.severity === 'error') errors++;
    else warnings++;

    // Said plainly rather than left to be worked out. The line and column are
    // real, and they are not positions in the file the author opens.
    const where = converted
      ? `${relative}  (converted HTML, line ${line})`
      : `${relative}:${line}:${column + 1}`;
    lines.push('', `${where}  ${diagnostic.severity}  TS${diagnostic.code}`);
    lines.push(`  ${diagnostic.message}`);

    const row = text[line - 1] ?? '';
    const trimmed = row.replace(/^\s+/, '');
    const shift = row.length - trimmed.length;
    // The caret line is drawn under the trimmed source, so the column moves left
    // by however much indentation was cut. A run is capped so one long span does
    // not wrap the terminal.
    const pad = ' '.repeat(Math.max(0, column - shift));
    const run = '~'.repeat(Math.max(1, Math.min(diagnostic.length, 60)));

    lines.push('', `    ${trimmed}`, `    ${pad}${run}`);
  }

  return { lines, errors, warnings };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The count at the end of a run.
 *
 * @param {{ errors: number, warnings: number, files: number }} totals
 * @returns {string}
 */
export function summarize({ errors, warnings, files }) {
  if (errors + warnings === 0) return `No type errors in ${files} files.`;
  return `${plural(errors, 'error')}, ${plural(warnings, 'warning')} in ${files} files`;
}
