/**
 * What loose files at the top of `app/icons/` are called.
 *
 * It is the name the one sheet already had, so a project that never makes a
 * subdirectory sees the URL it always saw.
 */
export declare const DEFAULT_LIBRARY = "icons";
/**
 * Where a library is served. At the site root, beside the author's public files,
 * because `<use href>` is written by hand and `/lucide.svg` is what someone
 * guesses.
 *
 * @param {string} library
 * @returns {string}
 */
export declare const spritePath: (library: string) => string;
/**
 * Every icon as one SVG document.
 *
 * Sorted by id, so two builds of the same directory produce the same bytes and
 * an ETag means what it says.
 *
 * @param {Array<{ id: string, file: string, svg: string }>} icons
 * @returns {string} an SVG document of `<symbol>`s
 * @throws when two files claim one id
 */
export declare function buildSprite(icons: Array<{
    id: string;
    file: string;
    svg: string;
}>): string;
/**
 * Refuses a hand-written public file at a library's URL.
 *
 * Two things would answer for `/lucide.svg`, and the two servers pick different
 * winners: the build copies the public directory first and writes the sprite
 * over it, while dev asks the public handler first and never reaches the sprite.
 * Rather than pick one, neither runs until the author has.
 *
 * Every library is checked, not just the default one. A library is named by a
 * directory the author made, so the set of URLs this claims grows with their
 * tree rather than being one name written down here.
 *
 * @param {string|null} publicDir the author's public directory, not the copy
 * @param {Array<{ name: string }>} libraries
 * @throws when a file already sits at a library's URL
 */
export declare function refuseSpriteClash(publicDir: string | null, libraries: Array<{
    name: string;
}>): void;
/**
 * Every library under `dir`, each ready for `buildSprite`.
 *
 * Loose files at the top are the default library. Each subdirectory is a library
 * of its own, named by the directory, which is what makes dropping a downloaded
 * icon set in here the whole of using it.
 *
 * One level. A directory inside a library is refused rather than flattened or
 * skipped: flattening would give two files one id, and skipping loses icons
 * without saying so. Sorted, so a build reads the same on any filesystem.
 *
 * @param {string} dir
 * @param {string} [root] what the reported file paths are relative to
 * @returns {Array<{ name: string, icons: Array<{ id: string, file: string, svg: string }> }>}
 *   empty if `dir` is absent, and a library with no icons in it is not one
 * @throws when a library holds a directory
 */
export declare function readLibraries(dir: string, root?: string): Array<{
    name: string;
    icons: Array<{
        id: string;
        file: string;
        svg: string;
    }>;
}>;
