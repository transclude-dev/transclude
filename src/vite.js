// Vite, loaded when a command needs it.
//
// Not the plugin: that is `plugin.js`, and this is only the import that reaches
// the package it plugs into.
//
// `vite` is an optional peer. `transclude-build` and `transclude-dev` are the
// two things that load it, and nothing on the serve path does, so a container
// running a built app should not carry a bundler it will never call. Optional
// means it can be absent, and an absent package reads as ERR_MODULE_NOT_FOUND
// naming a file inside this package, which tells the author nothing they can
// act on. This says what to install.
//
// No `node:` imports.

/**
 * The `vite` package, or an error naming what to install.
 *
 * @returns {Promise<typeof import('vite')>}
 * @throws when `vite` is not installed
 */
export async function loadVite() {
  try {
    return await import('vite');
  } catch (err) {
    // Only a missing `vite`. Vite failing to resolve something of its own
    // raises the same code from a different specifier, and swallowing that one
    // would hide a real break behind advice that does not apply.
    const missing =
      /** @type {{ code?: string, message?: string }} */ (err)?.code === 'ERR_MODULE_NOT_FOUND' &&
      /'vite'/.test(/** @type {{ message?: string }} */ (err)?.message ?? '');
    if (!missing) throw err;

    throw new Error(
      `[transclude] this command needs vite, and it is not installed. ` +
        `\`npm install -D vite\`. It builds and it serves in development; the built ` +
        `app never loads it, which is why it is not installed with the framework.`,
    );
  }
}
