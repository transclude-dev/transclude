// GET /feed.xml, from a list the app supplies.
//
// A sitemap comes from the route table, because a URL is all it lists. A feed
// needs a title, a date and something to read, and none of that is in the route
// table, so the app passes the items in. Everything else here is the format.

/** How many items ship. A reader wants the recent ones, not the archive. */
const LIMIT = 50;

const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * HTML, kept as HTML.
 *
 * `]]>` is the one sequence a CDATA section cannot hold, and it can appear in
 * ordinary markup: `<script>if (a[b[c]]>0)</script>`. Splitting it across two
 * sections is what the parser puts back together as the original three
 * characters.
 */
const cdata = (html) => `<![CDATA[${String(html).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

const date = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** An absolute URL, since a feed is read somewhere else by definition. */
const absolute = (hostname, path) => `${hostname.replace(/\/$/, '')}${path}`;

/**
 * The items, newest first.
 *
 * Sorting is stable, so items with no date keep the order they were given in
 * rather than being shuffled among the dated ones.
 */
/**
 * One entry, as an app writes it.
 *
 * @typedef {object} FeedItem
 * @property {string} [title]
 * @property {string} [url]
 * @property {string} [author]
 * @property {string|number|Date} [date]
 * @property {Date|null} [at] the parsed date, added on the way through
 *
 * @typedef {object} FeedConfig
 * @property {string} [hostname] every link is absolute, so this is required
 * @property {string} [title]
 * @property {'rss'|'atom'} [format]
 * @property {string} [author] required for Atom, unless every item has one
 * @property {string|number|Date} [updated]
 * @property {string} [path] where it is mounted
 * @property {number} [limit]
 * @property {FeedItem[]|(() => FeedItem[]|Promise<FeedItem[]>)} [items]
 */

/**
 * @param {FeedConfig} config `items` may be a function, so an app builds them
 *   from its own data
 * @returns {Promise<FeedItem[]>}
 */
async function itemsOf({ items = [], limit = LIMIT }) {
  const list = typeof items === 'function' ? await items() : await items;

  const dated = list.map((item, index) => ({ item, index, at: date(item.date) }));
  dated.sort((a, b) => {
    if (a.at && b.at && a.at.getTime() !== b.at.getTime()) {
      return b.at.getTime() - a.at.getTime();
    }
    if (a.at && !b.at) return -1;
    if (!a.at && b.at) return 1;
    return a.index - b.index;
  });

  return dated.slice(0, limit).map(({ item, at }) => ({ ...item, at }));
}

/** The feed's own timestamp: the newest thing in it. */
const newest = (items) => items.find((item) => item.at)?.at ?? null;

function rss(items, config, stamp) {
  const { hostname, title, description = '', path, language } = config;
  const self = absolute(hostname, path);

  const body = items.map((item) => {
    const url = absolute(hostname, item.path);
    const parts = [
      `      <title>${escape(item.title)}</title>`,
      `      <link>${escape(url)}</link>`,
      `      <guid isPermaLink="true">${escape(item.id ?? url)}</guid>`,
    ];
    if (item.at) parts.push(`      <pubDate>${item.at.toUTCString()}</pubDate>`);
    if (item.description) parts.push(`      <description>${cdata(item.description)}</description>`);
    if (item.content) {
      parts.push(`      <content:encoded>${cdata(item.content)}</content:encoded>`);
    }
    return `    <item>\n${parts.join('\n')}\n    </item>`;
  });

  const head = [
    `    <title>${escape(title)}</title>`,
    `    <link>${escape(absolute(hostname, '/'))}</link>`,
    `    <description>${escape(description)}</description>`,
    `    <atom:link href="${escape(self)}" rel="self" type="application/rss+xml"/>`,
  ];
  if (language) head.push(`    <language>${escape(language)}</language>`);
  if (stamp) head.push(`    <lastBuildDate>${stamp.toUTCString()}</lastBuildDate>`);

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" ` +
    `xmlns:content="http://purl.org/rss/1.0/modules/content/">\n` +
    `  <channel>\n${head.join('\n')}\n${body.join('\n')}\n  </channel>\n</rss>\n`
  );
}

function atom(items, config, stamp) {
  const { hostname, title, description = '', path, author } = config;
  const self = absolute(hostname, path);

  const person = (who) =>
    `<author><name>${escape(who.name)}</name>` +
    (who.email ? `<email>${escape(who.email)}</email>` : '') +
    `</author>`;

  const body = items.map((item) => {
    const url = absolute(hostname, item.path);
    const parts = [
      `    <title>${escape(item.title)}</title>`,
      `    <link href="${escape(url)}"/>`,
      `    <id>${escape(item.id ?? url)}</id>`,
      `    <updated>${(item.at ?? stamp).toISOString()}</updated>`,
    ];
    if (item.author) parts.push(`    ${person(item.author)}`);
    if (item.description) parts.push(`    <summary>${escape(item.description)}</summary>`);
    if (item.content) {
      parts.push(`    <content type="html">${cdata(item.content)}</content>`);
    }
    return `  <entry>\n${parts.join('\n')}\n  </entry>`;
  });

  const head = [
    `  <title>${escape(title)}</title>`,
    `  <link href="${escape(absolute(hostname, '/'))}"/>`,
    `  <link rel="self" href="${escape(self)}"/>`,
    `  <id>${escape(absolute(hostname, '/'))}</id>`,
    `  <updated>${stamp.toISOString()}</updated>`,
  ];
  if (description) head.push(`  <subtitle>${escape(description)}</subtitle>`);
  if (author) head.push(`  ${person(author)}`);

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n${head.join('\n')}\n${body.join('\n')}\n</feed>\n`
  );
}

/**
 * What the response is served as. A reader picks the parser from this.
 *
 * @param {FeedConfig|null|undefined} config
 * @returns {string}
 */
export const feedType = (config) =>
  config?.format === 'atom'
    ? 'application/atom+xml; charset=utf-8'
    : 'application/rss+xml; charset=utf-8';

/**
 * Where it is mounted, and where the build writes it.
 *
 * @param {FeedConfig|null|undefined} config
 * @returns {string}
 */
export const feedPath = (config) => config?.path ?? '/feed.xml';

/**
 * @param {FeedConfig} [config] the `feed` block, plus its `items`
 * @returns {Promise<string>} an RSS or Atom document
 * @throws when Atom is asked for without an author or a date
 */
export async function feed(config = {}) {
  const { hostname, title, format = 'rss', author, updated } = config;

  if (!hostname) throw new Error('[transclude] feed needs a hostname, since every link is absolute');
  if (!title) throw new Error('[transclude] feed needs a title');

  const items = await itemsOf(config);

  // Nothing here may read the clock. A prerendered feed is written once and
  // compressed once, and a timestamp from the build would change the bytes on
  // every run for a file whose contents did not change.
  const stamp = date(updated) ?? newest(items);

  if (format === 'atom') {
    if (!author && !items.every((item) => item.author)) {
      throw new Error(
        '[transclude] an Atom feed needs an author: give the feed one, or every item its own',
      );
    }
    if (!stamp) {
      throw new Error(
        '[transclude] an Atom feed needs a date: give an item a `date`, or the feed an `updated`',
      );
    }
    return atom(items, { ...config, path: feedPath(config) }, stamp);
  }

  return rss(items, { ...config, path: feedPath(config) }, stamp);
}
