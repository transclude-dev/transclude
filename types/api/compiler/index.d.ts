import { CompileError, frameOf } from './codegen.js';
export type ParsedNode = import('./html.js').ParsedNode;
import { ELEMENT_FLAGS, ScriptError } from './script.js';
export { CompileError, ScriptError, ELEMENT_FLAGS, frameOf };
/**
 * An element's flags, read without compiling it.
 *
 * The plugin needs `shadow` before it can compile anything, because how a tag
 * renders decides how every other file that mentions it compiles. Same block
 * and the same reader as the compile itself, so there is one answer.
 *
 * @param {string} source the whole .html file
 * @param {string} [label] what to call it in an error
 * @returns {Record<string, boolean>} one entry per `ELEMENT_FLAGS` name
 */
export declare function readFlags(source: string, label?: string): Record<string, boolean>;
/**
 * What the block declares, without compiling it.
 *
 * A light element is registered only when it has behavior to attach, and three
 * different places ask that question: the compiler, so it knows whether to emit
 * anchors; the plugin, so it knows whether to ship the definition; and the type
 * extractor, so `transclude-env.d.ts` does not claim accessors that were never
 * defined. One reader, so they cannot drift apart.
 *
 * @param {string} source the whole .html file
 * @param {string} [label] what to call it in an error
 * @returns {{ state: boolean, prototype: boolean, formAssociated: boolean,
 *   behavior: boolean }}
 */
export declare function readBehavior(source: string, label?: string): {
    state: boolean;
    prototype: boolean;
    formAssociated: boolean;
    behavior: boolean;
};
export type Block = {
    code: string;
    line: number;
    offset: number;
};
export type HeadBlock = Block & {
    attrs: {
        name: string;
        value: string;
    }[];
};
export type Blocks = {
    /**
     * the loader, page only
     */
    server: Block | null;
    /**
     * the whole element declaration, element only
     */
    element: Block | null;
    client: Block[];
    head: HeadBlock[];
    styles: string[];
    /**
     * everything that was not a block
     */
    nodes: ParsedNode[];
    /**
     * from the second parse, for its attributes
     */
    html: ParsedNode | null;
    /**
     * the same
     */
    body: ParsedNode | null;
};
/**
 * Top-level <script>/<style> blocks are pulled out; everything else is template.
 *
 *   <script server>      data loading, page only
 *   <script element>     the whole element declaration, element only
 *   <script>             client code, page only
 *   <style>              scoped to the shadow root (component) or the page
 *
 * Each block carries the line it starts on so parse errors can point back into
 * the .html file rather than into generated output.
 *
 * One `<script>` or `<style>` block, with where it starts. Both are recorded so
 * a parse error points into the .html file rather than into generated output.
 *
 * @typedef {object} Block
 * @property {string} code
 * @property {number} line
 * @property {number} offset
 *
 * @typedef {Block & { attrs: { name: string, value: string }[] }} HeadBlock
 *   a `<script head>`, which is emitted verbatim and keeps its attributes
 *
 * @typedef {object} Blocks
 * @property {Block|null} server the loader, page only
 * @property {Block|null} element the whole element declaration, element only
 * @property {Block[]} client
 * @property {HeadBlock[]} head
 * @property {string[]} styles
 * @property {ParsedNode[]} nodes everything that was not a block
 * @property {ParsedNode|null} html from the second parse, for its attributes
 * @property {ParsedNode|null} body the same
 *
 * @param {string} source
 * @returns {Blocks} the script blocks, the styles, the markup nodes and the
 *   `<html>` element read from a second parse
 */
export declare function splitBlocks(source: string): Blocks;
/**
 * Compiles one element. `export const shadow = true` in the file decides which
 * kind it is, so the file answers for itself.
 *
 * Light is the default: styles scoped with `@scope`, markup inline, page CSS
 * reaching it, and form controls and `<label for>` working because there is no
 * boundary. A shadow root is the opt-in, with everything that follows from it.
 */
export declare function compileComponent(source: any, { tag, shadow, components, shadowTags, runtime, filename, nested }: {
    components?: Map<any, any>;
    filename?: string;
    nested?: any[];
    runtime: any;
    shadow?: boolean;
    shadowTags?: Set<any>;
    tag: any;
}): {
    code: string;
    warnings: string[];
    isShadow: boolean;
    hasScript: boolean;
    components: string[];
};
/**
 * A page: the `<script server>` block, the markup, and whatever layouts wrap it.
 *
 * `filename` is what an error message says, which is the short route id.
 * `sourcePath` is what the source map names, which is a path an editor opens.
 *
 * @param {string} source
 * @param {{ components?: Map<string, string>, shadowTags?: Set<string>,
 *   runtime: string, filename?: string, sourcePath?: string|null,
 *   layouts?: string[],
 *   client?: { tags: string[], hasScript: boolean, needed: boolean } }} options
 * @returns {{ code: string, map: string|null, warnings: string[],
 *   components: string[] }} the module, a line-level map or null when there is
 *   no markup to map, whatever the template warned about, and the tags it used
 */
export declare function compilePage(source: string, { components, shadowTags, runtime, filename, sourcePath, layouts, client, }: {
    components?: Map<string, string>;
    shadowTags?: Set<string>;
    runtime: string;
    filename?: string;
    sourcePath?: string | null;
    layouts?: string[];
    client?: {
        tags: string[];
        hasScript: boolean;
        needed: boolean;
    };
}): {
    code: string;
    map: string | null;
    warnings: string[];
    components: string[];
};
/**
 * A layout is a page that renders a hole. `render` receives the slot map its
 * child produced, and returns its own for the level above.
 *
 * @param {string} source
 * @param {{ id: string, components?: Map<string, string>,
 *   shadowTags?: Set<string>, runtime: string,
 *   sourcePath?: string|null }} options
 * @returns {{ code: string, map: string|null, warnings: string[],
 *   components: string[] }} the module, a line-level map or null when there is
 *   nothing to map, the warnings, and the tags it used
 */
export declare function compileLayout(source: string, { id, components, shadowTags, runtime, sourcePath }: {
    id: string;
    components?: Map<string, string>;
    shadowTags?: Set<string>;
    runtime: string;
    sourcePath?: string | null;
}): {
    code: string;
    map: string | null;
    warnings: string[];
    components: string[];
};
/**
 * Wraps a light element's styles in `@scope`, rooted at its own tag. A custom
 * element name is already a valid selector, so nothing has to be hashed.
 *
 * The `to` clause is the donut: styles stop at any light element nested inside,
 * so an outer one cannot reach into one it merely contains.
 *
 * @param {string} css
 * @param {string} tag the element the rules belong to
 * @param {string[]} [nested] tags rendered inside it, which the scope has to reach
 * @returns {string}
 */
export declare function scopeCss(css: string, tag: string, nested?: string[]): string;
/**
 * Component tags a template uses. This is how only those get shipped.
 *
 * @param {string} source
 * @param {Map<string, string>|Set<string>} registry every known tag
 * @returns {Set<string>} the tags this source renders
 */
export declare function usedComponents(source: string, registry: Map<string, string> | Set<string>): Set<string>;
/**
 * Browser entry: define every component, then run the page's own client code.
 * This one is a real module, so the client block keeps its imports and may use
 * top-level await. It is only checked, not rewritten.
 *
 * `elements` adds the loader for everything else: the page's own tags are
 * imported statically and defined before first paint, and any other tag in the
 * app is one dynamic import away, taken only if it ever shows up in the DOM.
 *
 * @param {Array<{ source: string, filename: string }>} sources the files whose
 *   `<script>` blocks run in the browser, layouts first and the page last
 * @param {{ tags?: string[] }} what the elements to define. Not bracketed even
 *   though it has a default: JSDoc reads the tags positionally, and an optional
 *   one cannot come before the required `options` below.
 * @param {{ runtime: string, elements?: boolean }} options required, not
 *   defaulted: `runtime` is written into the module's import, and without it the
 *   output says `from undefined` and fails only when something tries to load it
 * @returns {{ code: string }} the code is empty when the page needs no entry
 */
export declare function compileClientEntry(sources: Array<{
    source: string;
    filename: string;
}>, { tags }: {
    tags?: string[];
}, { runtime, elements }: {
    runtime: string;
    elements?: boolean;
}): {
    code: string;
};
/** The id of the module `compileClientEntry` reaches for when `elements` is on. */
export declare const ELEMENTS_ENTRY = "virtual:transclude-elements";
/**
 * tag -> dynamic import, for every element in the app.
 *
 * A thunk rather than a URL: the bundler is the only thing that knows where the
 * chunk lands, and `import()` is how you ask it. Nothing has to be written into
 * a manifest, threaded through the server, or kept in sync with a hash.
 *
 * @param {Iterable<string>} tags every element the app defines
 * @returns {{ code: string }}
 */
export declare function compileElementsEntry(tags: Iterable<string>): {
    code: string;
};
