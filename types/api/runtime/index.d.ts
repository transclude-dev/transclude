declare class RawHtml {
    value: any;
    constructor(value: any);
    toString(): any;
}
/**
 * Opt out of escaping: `${html(post.body)}`. The only way to inject markup.
 *
 * @param {unknown} value
 * @returns {RawHtml} written through untouched
 */
export declare function html(value: unknown): RawHtml;
/**
 * Every `${}` in text position goes through this.
 *
 * @param {unknown} value
 * @returns {string} empty for null, undefined and false
 */
export declare function escape(value: unknown): string;
/**
 * Data for a `<script>`, as JSON that cannot escape the element.
 *
 * This is the only interpolation a script may carry, and the compiler refuses
 * every other one. Nothing can make `${expr}` safe in a position where the
 * result is read as code: a value ending the string it was written into runs
 * whatever follows, and no escaping of the surrounding HTML changes that. Data
 * is a different question and has an answer, so that is the part offered.
 *
 * @param {unknown} value anything `JSON.stringify` accepts
 * @returns {RawHtml} the JSON, safe to write inside a script element
 */
export declare function json(value: unknown): RawHtml;
/**
 * Interpolation inside a larger string, which is a mixed attribute value.
 *
 * It does not escape, because the caller does: every use is concatenated and
 * handed to `attr`, which escapes the whole result. Do not reach for this from a
 * position that writes straight into the document.
 *
 * @param {unknown} value
 * @returns {string}
 */
export declare function str(value: unknown): string;
/**
 * Dynamic attribute. false, null and undefined drop the attribute rather than
 * becoming a string, or you get class="false" in the output.
 * true emits a bare boolean attribute. Objects/arrays serialize as JSON so the
 * client can read them back off the element.
 *
 * @param {string} name
 * @param {unknown} value
 * @returns {string} a leading space and the pair, or empty to drop it
 */
export declare function attr(name: string, value: unknown): string;
/**
 * `pageSize` <-> `page-size`. HTML lowercases attribute names, so a camelCase
 * prop would never match the attribute it came from. Lit has the same rule, for
 * the same reason.
 *
 * @param {string} prop
 * @returns {string}
 */
export declare function attrName(prop: string): string;
/**
 * @param {Record<string, unknown>|null|undefined} defs the prop table
 * @param {Record<string, unknown>|null|undefined} props either spelling
 * @param {Record<string, { from?: Function, to?: Function }>} [specs]
 * @returns {Record<string, unknown>} keyed by prop name, never by attribute
 */
export declare function coerceProps(defs: Record<string, unknown> | null | undefined, props: Record<string, unknown> | null | undefined, specs?: Record<string, {
    from?: Function;
    to?: Function;
}>): Record<string, unknown>;
/**
 * The text node a ${} owns, carved out of the one the parser actually built.
 *
 * `Hello ${name}!` is a single text node reading "Hello Ada!". Both static
 * sides have lengths known at compile time, so the dynamic middle splits out
 * exactly. No marker comments in the served HTML, and nothing evaluated.
 *
 * @param {Node} parent
 * @param {Text|null} node the text node the parser built, if any
 * @param {number} prefix static characters before the expression
 * @param {number} suffix static characters after it
 * @returns {Text}
 */
export declare function textAt(parent: Node, node: Text | null, prefix: number, suffix: number): Text;
/**
 * False means the value cannot live in a text node, so the caller repaints.
 *
 * @param {Text} node
 * @param {unknown} value
 * @returns {boolean} false when the value cannot live in a text node
 */
export declare function setText(node: Text, value: unknown): boolean;
/**
 * The update-time counterpart of attr(), with the same rules.
 *
 * @param {Element} element
 * @param {string} name
 * @param {unknown} value
 * @returns {void}
 */
export declare function setAttr(element: Element, name: string, value: unknown): void;
/**
 * Several ${} in one text node: rewrite the whole thing rather than split it.
 *
 * @param {Text} node
 * @param {unknown[]} parts
 * @returns {boolean} false when any part has to be markup
 */
export declare function setParts(node: Text, parts: unknown[]): boolean;
/**
 * The node after a block nobody bound.
 *
 * A light element renders its blocks once and never rebuilds them, so it holds
 * no state for one. The walk that finds every node after it still has to get
 * past it, and how wide it is only the anchors say.
 *
 * @param {Comment} open the opening anchor
 * @returns {Node|null}
 */
export declare function afterBlock(open: Comment): Node | null;
/**
 * @param {Comment} open the opening anchor
 * @param {object} block the compiled block
 * @param {object} props
 * @param {unknown[]} [args] enclosing loop variables
 * @returns {object} the state `updateBlock` writes through
 */
export declare function blockAt(open: Comment, block: object, props: object, args?: unknown[]): object;
/**
 * @param {object} state from `blockAt`
 * @param {object} block
 * @param {object} props
 * @param {unknown[]} [args]
 * @returns {boolean} false when the caller has to repaint instead
 */
export declare function updateBlock(state: object, block: object, props: object, args?: unknown[]): boolean;
/**
 * What to parse this parent's new markup inside, as a tag to create and a tag
 * to wrap the markup in.
 *
 * Exported to be tested. Whether a browser then parses into the namespace this
 * asks for is a browser's answer, and `app/routes/check.html` in the showcase is
 * where that is asked.
 *
 * @param {{ nodeType?: number, namespaceURI?: string, localName?: string, tagName?: string }} parent
 * @returns {{ tag: string, wrap: string|null }}
 */
export declare function holderFor(parent: {
    nodeType?: number;
    namespaceURI?: string;
    localName?: string;
    tagName?: string;
}): {
    tag: string;
    wrap: string | null;
};
/**
 * @param {Element} element
 * @param {Record<string, unknown>} defs the declared defaults
 * @returns {Record<string, unknown>} the same object for the life of the element
 */
export declare function stateOf(element: Element, defs: Record<string, unknown>): Record<string, unknown>;
/**
 * The inverse: writing a property back to the attribute that backs it.
 *
 * @param {Element} element
 * @param {string} prop
 * @param {unknown} value
 * @param {unknown} fallback the declared default
 * @param {object} [specs]
 * @returns {void}
 */
export declare function writeProp(element: Element, prop: string, value: unknown, fallback: unknown, specs?: object): void;
/**
 * A component's attribute, serialized the way that component reads it back.
 * The parent's template cannot know that a Date crosses the boundary as an ISO
 * string rather than as JSON. The child's `to` does.
 *
 * @param {object} def the compiled element module
 * @param {string} name
 * @param {unknown} value
 * @returns {string}
 */
export declare function attrProp(def: object, name: string, value: unknown): string;
/**
 * The same, for an update writing into an already-rendered child.
 *
 * @param {object} def
 * @param {Element} element
 * @param {string} name
 * @param {unknown} value
 * @returns {void}
 */
export declare function setAttrProp(def: object, element: Element, name: string, value: unknown): void;
/**
 * Server side of the component: the shadow root, inline, so the page is correct
 * before any JS runs. Nested DSD works because the HTML parser handles it.
 *
 * Except in a fragment. A fragment is swapped into a document that is already
 * live, and nothing that does the swapping processes a declarative shadow root.
 * Not innerHTML, not DOMParser, and none of the libraries built on them. The
 * template would land dead and the component would never exist.
 *
 * So a fragment ships the element bare: the tag and its attributes, nothing
 * inside. `connectedCallback` finds no shadow root, attaches one and paints,
 * and that paint goes through setHTMLUnsafe, which does process the nested
 * declarative roots underneath it. Nothing is lost by leaving it out. Server
 * rendering buys a correct first paint, and a fragment arrives long after first
 * paint.
 *
 * @param {object} def
 * @param {object} props
 * @param {boolean} [fragment] true returns empty: nothing that swaps HTML
 *   processes a declarative shadow root, so the element paints itself
 * @returns {string}
 */
export declare function shadow(def: object, props: object, fragment?: boolean): string;
/**
 * What a template sees, on the server: state defaults under the props.
 *
 * The same order the element uses once it is live, so the first paint and every
 * later one read the same shape. Rendering props alone wrote `undefined` wherever
 * a template named state.
 *
 * @param {object} def
 * @param {object} props
 * @returns {Record<string, unknown>} state underneath, props on top
 */
export declare function data(def: object, props: object): Record<string, unknown>;
/**
 * A light element rendered for insertion into a live document: its own markup,
 * with any shadow element inside it left bare for the client to paint.
 *
 * Its styles are left out on purpose. They are one `<style>` per tag in <head>,
 * not one per use, so putting them here would ship a copy on every swap. When
 * the swapped markup names a tag the document has never rendered, `watch`
 * notices it and `adoptStyles` adds them once.
 */
/**
 * What an external include renders: the fragment the server fetched, the
 * element's own children if it could not be read, or a throw if there are
 * neither.
 *
 * A page with no fallback that silently rendered a hole would be worse than one
 * that fails: the hole looks like content nobody wrote.
 *
 * @param {Record<string, unknown>|null|undefined} data
 * @param {string} key the src exactly as written
 * @param {string|null} fallback the element's children, or null if it had none
 * @returns {string}
 * @throws when the source failed and there is no fallback
 */
export declare function included(data: Record<string, unknown> | null | undefined, key: string, fallback: string | null): string;
/**
 * @param {object} def
 * @param {object} [props]
 * @param {object} [slots]
 * @returns {string}
 */
export declare function fragment(def: object, props?: object, slots?: object): string;
/**
 * A light element's styles, in <head>, at most once per tag.
 *
 * The server writes the same `<style data-transclude="tag">` for every light element the
 * document rendered, so the marker is the whole agreement. If one is already
 * there, these styles are applied and this does nothing. That is why the
 * attribute is on the server's output too. A page that renders <site-note> and a
 * swap that brings one in must not end up with two copies.
 *
 * Inserted *before* the document's own <style>, not appended, because that is
 * where the server would have put it: a page's rules override an element's.
 *
 * @param {object} def
 * @returns {void}
 */
export declare function adoptStyles(def: object): void;
/**
 * Loads element definitions for tags that arrive after the page did.
 *
 * A page's client entry defines what the page can render. A fragment swapped in
 * from another route can contain anything, and it arrives as plain markup. A
 * light element arrives with no styles, a shadow one with no definition.
 *
 * The framework does not do the swapping. Whoever does, whether htmx, Turbo or a
 * short fetch, cannot be counted on to announce it, and half of them use plain
 * innerHTML. So this watches the result rather than the cause: whatever put the
 * tag in the document, it is in the document, and that is the signal.
 *
 * `loaders` is tag -> dynamic import, so a tag that never appears costs one
 * string. The observer disconnects once every tag it knows about has been seen.
 *
 * It does not look inside shadow roots. It does not need to: a component's own
 * `define` brings the elements it renders with it.
 *
 * @param {Record<string, () => Promise<unknown>>} loaders tag to dynamic import
 * @param {Document} [root]
 * @returns {() => void} stops the observer
 */
export declare function watch(loaders: Record<string, () => Promise<unknown>>, root?: Document): () => void;
/**
 * Client side of the same component. On first connect the shadow root already
 * exists, because the parser attached it from the DSD template, so nothing
 * repaints. Rendering it on the server is what makes that possible.
 */
/**
 * A light element has no shadow root to repaint, and repainting would destroy
 * the children the page put inside it. So it upgrades for behavior only: the
 * markup it was served is the markup it keeps.
 *
 * @param {object} def
 * @returns {void}
 */
export declare function defineLight(def: object): void;
/**
 * @param {object} def
 * @returns {void}
 */
export declare function defineComponent(def: object): void;
export {};
