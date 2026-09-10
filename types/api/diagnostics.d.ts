export type Diagnostic = {
    offset: number;
    length: number;
    message: string;
    code: number;
    severity: string;
    file?: string;
};
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
export declare function reportFor(file: string, diagnostics: Diagnostic[], { root, source, converted, positionAt }: {
    root: string;
    source: string;
    converted?: boolean;
    positionAt: (source: string, offset: number) => {
        line: number;
        column: number;
    };
}): {
    lines: string[];
    errors: number;
    warnings: number;
};
/**
 * The count at the end of a run.
 *
 * @param {{ errors: number, warnings: number, files: number }} totals
 * @returns {string}
 */
export declare function summarize({ errors, warnings, files }: {
    errors: number;
    warnings: number;
    files: number;
}): string;
