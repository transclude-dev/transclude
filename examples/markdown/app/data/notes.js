// Read by the loader in index.md. Data is data whichever format the page is.

/**
 * @typedef {object} Note
 * @property {string} title
 * @property {string} body
 */

/** @type {Note[]} */
export const notes = [
  { title: 'One file', body: 'The page and the loader are the same file.' },
  { title: 'One compiler', body: 'Markdown becomes HTML before anything compiles it.' },
  { title: 'No runtime', body: 'The element above is rendered on the server.' },
];
