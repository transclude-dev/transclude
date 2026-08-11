// The visible date on a post, formatted the way the machine-readable one reads.
//
// `posts.js` writes `new Date('2026-08-11')`, which is midnight UTC.
// `toDateString()` renders in the zone of whatever machine ran the build, so
// west of UTC it printed the day before: the page said Aug 10, the `datetime`
// attribute said the 11th, and the feed said the 11th. Nobody east of UTC could
// see it, and a build machine on UTC could not either.

/**
 * `Tue Aug 11 2026`, read in UTC.
 *
 * The same fields `toDateString()` gives, from `toUTCString()`, which is the
 * one formatter with a fixed zone. `Tue, 11 Aug 2026 00:00:00 GMT` in, the
 * first four fields out, reordered.
 *
 * @param {Date} date
 * @returns {string}
 */
export function dateline(date) {
  const [weekday, day, month, year] = date.toUTCString().split(' ');
  return `${weekday.replace(',', '')} ${month} ${day} ${year}`;
}
