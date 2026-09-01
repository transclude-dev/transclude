export type ParsedNode = import('./compiler/html.js').ParsedNode;
/**
 * A heading's text as an id, the way GitHub and MDN write one.
 *
 * Unicode letters and numbers are kept rather than folded to ASCII: a document
 * whose headings are not in English should still be addressable in its own
 * script.
 *
 * @param {string} text
 * @returns {string} lowercased, punctuation dropped, spaces hyphenated
 */
export declare function slugify(text: string): string;
/**
 * Every id the document offers, explicit and generated, worked out in one pass.
 *
 * The whole table is built before any single fragment is resolved. Computing a
 * slug on demand would make the suffix a heading gets depend on which fragment
 * was asked for, so the same URL would mean different things on different
 * requests.
 *
 * @param {string} html
 * @returns {Indexed} the indexed document
 */
export declare function readDocument(html: string): Indexed;
export type Indexed = {
    root: ParsedNode;
    ids: Map<string, ParsedNode>;
    /**
     * a heading's text, slugified
     */
    slugs: Map<string, ParsedNode>;
    /**
     * ids written twice, which name nothing
     */
    duplicates: Set<string>;
    /**
     *   every fragment the document offers, in document order
     */
    order: Array<{
        id: string;
        element: ParsedNode;
        implicit: boolean;
    }>;
};
/**
 * The same table, over a tree that has already been parsed.
 *
 * The proxy sanitizes and rewrites a foreign document before indexing it, and
 * indexing first would leave the table naming elements the cleaning removed.
 *
 * A parsed document with the tables a fragment lookup needs.
 *
 * @typedef {object} Indexed
 * @property {ParsedNode} root
 * @property {Map<string, ParsedNode>} ids
 * @property {Map<string, ParsedNode>} slugs a heading's text, slugified
 * @property {Set<string>} duplicates ids written twice, which name nothing
 * @property {Array<{ id: string, element: ParsedNode, implicit: boolean }>} order
 *   every fragment the document offers, in document order
 *
 * @param {ParsedNode} root a parse5 tree
 * @returns {Indexed} the same root, with its id table
 */
export declare function indexDocument(root: ParsedNode): Indexed;
/**
 * The fragment named by `id`, or null if the document does not offer one.
 *
 * `nodes` is a list, not one element. A heading run is several siblings, and
 * wrapping them in a container would mean the fetched fragment did not match
 * what the source document renders in that place.
 *
 * @param {string|Indexed} input the HTML, or an already indexed document
 * @param {string} id
 * @returns {{ id: string, implicit: boolean, nodes: object[], html: string,
 *   kind: string, standalone: boolean, diagnostics: object[] }|null} null when
 *   nothing answers to that id
 */
export declare function resolveFragment(input: string | Indexed, id: string): {
    id: string;
    implicit: boolean;
    nodes: object[];
    html: string;
    kind: string;
    standalone: boolean;
    diagnostics: object[];
} | null;
/**
 * Every fragment the document offers, in document order.
 *
 * This is the claim that the rules work on markup nobody wrote for us: run it
 * over a page and the result should read like that page's outline.
 *
 * @param {string|Indexed} input
 * @returns {Array<{ id: string, implicit: boolean, tag: string, rank: number, kind: string, text: string }>}
 */
export declare function listFragments(input: string | Indexed): Array<{
    id: string;
    implicit: boolean;
    tag: string;
    rank: number;
    kind: string;
    text: string;
}>;
