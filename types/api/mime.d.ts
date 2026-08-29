/** What a file of a kind nobody here knows is sent as. */
export declare const DEFAULT_TYPE = "application/octet-stream";
/**
 * Extension, without the dot, to Content-Type.
 *
 * A text type carries `charset=utf-8`, since that is what this framework writes
 * and a browser otherwise guesses per locale. Binary types carry no charset.
 */
export declare const TYPES: {
    html: string;
    htm: string;
    xhtml: string;
    css: string;
    js: string;
    mjs: string;
    wasm: string;
    json: string;
    jsonld: string;
    map: string;
    webmanifest: string;
    xml: string;
    csv: string;
    txt: string;
    md: string;
    ics: string;
    pdf: string;
    rtf: string;
    epub: string;
    zip: string;
    gz: string;
    bin: string;
    svg: string;
    png: string;
    jpg: string;
    jpeg: string;
    gif: string;
    webp: string;
    avif: string;
    bmp: string;
    ico: string;
    tif: string;
    tiff: string;
    m4a: string;
    mp3: string;
    aac: string;
    wav: string;
    flac: string;
    ogg: string;
    oga: string;
    opus: string;
    weba: string;
    mid: string;
    midi: string;
    mp4: string;
    m4v: string;
    mov: string;
    webm: string;
    ogv: string;
    ogx: string;
    mpeg: string;
    avi: string;
    av1: string;
    ts: string;
    m3u8: string;
    vtt: string;
    '3gp': string;
    '3g2': string;
    woff2: string;
    woff: string;
    ttf: string;
    otf: string;
    eot: string;
    gltf: string;
    glb: string;
};
/**
 * Whether the table has a type for this file.
 *
 * `Object.hasOwn`, because the name comes off a URL: `/x.constructor` finds a
 * function on `Object.prototype` with a plain lookup, and the type of that file
 * would go out as `function Object() { [native code] }`. `.bin` is in the table
 * on purpose and is a known type, so this is not "does it come out as
 * octet-stream".
 *
 * @param {string} file
 * @returns {boolean}
 */
export declare function known(file: string): boolean;
/**
 * The Content-Type for a file name, a path or a URL.
 *
 * @param {string} file
 * @returns {string} the type, or `application/octet-stream`
 */
export declare function typeOf(file: string): string;
