// The posts, newest first.
//
// Only what something other than the post itself needs: the index lists these,
// the feed is built from them, and the sitemap follows the routes. The writing
// lives in `app/routes/blog/<slug>.html`, which is an ordinary page, so a post
// gets the same highlighter and the same voice check as everything else.
//
// Two places name a post, so a test asserts they agree. Adding an entry here
// without the file gives a link to a 404, and adding the file without an entry
// writes a page nothing links to and no feed mentions.

/**
 * @typedef {object} Post
 * @property {string} slug the file under `app/routes/blog/`, and the URL
 * @property {string} title
 * @property {string} summary one sentence, used by the index and the feed
 * @property {Date} date
 */

/** @type {Post[]} */
export const posts = [
  {
    slug: 'two-templates-one-thing',
    title: 'Your page and your partial are two templates',
    summary:
      'Anything that swaps HTML needs a second template for the piece. Two templates for one thing is a pair that drifts, and nothing fails when they do.',
    date: new Date('2026-08-11'),
  },
  {
    slug: 'svg-already-does-transclusion',
    title: 'SVG already does transclusion',
    summary:
      'One tag has pointed at an element by id and rendered it in place for fifteen years. It only works for shapes.',
    date: new Date('2026-08-06'),
  },
];

/** Newest first, which is the order every page wants. */
export const byDate = () => [...posts].sort((a, b) => b.date - a.date);

/**
 * The entry a post page takes its title, summary and date from.
 *
 * Throws rather than returning nothing. A slug with no entry is a post that was
 * renamed on one side only, and the alternative is a page that builds with an
 * empty dateline and an empty sharing card.
 *
 * @param {string} slug
 * @returns {Post}
 */
export function bySlug(slug) {
  const found = posts.find((one) => one.slug === slug);
  if (!found) throw new Error(`no entry in posts.js for ${slug}`);
  return found;
}
