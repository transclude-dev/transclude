// File-based routing. The directory tree is the route table; Hono does the
// matching. Pure functions only. The plugin and the server both scan, and they
// must not be able to disagree.
//
//   routes/index.html            ->  /
//   routes/about.html            ->  /about
//   routes/blog/index.html       ->  /blog
//   routes/blog/[slug].html      ->  /blog/:slug
//   routes/docs/[...path].html   ->  /docs/:path{.+}
//   routes/api/people.js         ->  /api/people, an endpoint rather than a page
//   routes/404.html              ->  the not-found handler, not a route
//   routes/500.html              ->  the error page, not a route
//   routes/_partial.html         ->  ignored, as is anything under an _ directory

import fs from 'node:fs';
import path from 'node:path';

const EXT = '.html';
/**
 * A `.js` file in the routes tree is an endpoint: a route with no template, no
 * layout and no regions, which answers with a `Response` of its own. Same
 * filename rules as a page, so `[param]`, `[...rest]` and `index` all work,
 * because it is the same route table.
 */
const ENDPOINT_EXT = '.js';
const NOT_FOUND = '404';
/**
 * Not a route either: nothing links to `/500`, and a request for it is not what
 * makes it render. An unhandled throw is. Prerendered like the not-found page,
 * because a page that renders when something is already broken should not need a
 * loader, a database, or anything else that can also be broken.
 */
const ERROR = '500';

/**
 * @param {string} dir
 * @returns {object[]} one entry per file the tree routes to
 */
export function scanRoutes(dir) {
  const routes = [];
  const endpoints = [];
  let notFound = null;
  let error = null;

  const seen = new Map();
  for (const rel of walk(dir)) {
    const route = toRoute(rel, path.join(dir, rel));

    if (route.kind === 'page' && route.id === NOT_FOUND) {
      notFound = route;
      continue;
    }
    if (route.kind === 'page' && route.id === ERROR) {
      error = route;
      continue;
    }
    // One pattern, one answer. A page and an endpoint claiming the same URL is
    // the same mistake as two pages claiming it.
    const clash = seen.get(route.pattern) ?? seen.get(route.id);
    if (clash) {
      throw new Error(
        `[transclude] ${rel} and ${clash} collide (${route.pattern}, id ${route.id}). Rename one`,
      );
    }
    seen.set(route.pattern, rel);
    seen.set(route.id, rel);
    (route.kind === 'page' ? routes : endpoints).push(route);
  }

  routes.sort(bySpecificity);
  endpoints.sort(bySpecificity);
  return { routes, endpoints, notFound, error };
}

/**
 * @param {string} rel the path under the routes directory
 * @param {string} file
 * @returns {object} its id, URL pattern, params and kind
 */
export function toRoute(rel, file) {
  const kind = rel.endsWith(ENDPOINT_EXT) ? 'endpoint' : 'page';
  const ext = kind === 'endpoint' ? ENDPOINT_EXT : EXT;
  const parts = rel.slice(0, -ext.length).split(path.sep);

  // `blog/index.html` and `blog.html` both mean /blog; the trailing `index`
  // is addressing, not a path segment.
  const named = parts.at(-1) === 'index' ? parts.slice(0, -1) : parts;
  const segments = named.map(parseSegment);

  return {
    kind,
    id: idOf(parts),
    file,
    rel,
    segments,
    pattern: patternOf(segments),
    params: segments.filter((s) => s.kind !== 'static').map((s) => s.name),
    hasRest: segments.some((s) => s.kind === 'rest'),
  };
}

function parseSegment(name) {
  const rest = /^\[\.\.\.(.+)\]$/.exec(name);
  if (rest) return { kind: 'rest', name: rest[1] };

  const param = /^\[(.+)\]$/.exec(name);
  if (param) return { kind: 'param', name: param[1] };

  return { kind: 'static', name };
}

function patternOf(segments) {
  if (!segments.length) return '/';
  return (
    '/' +
    segments
      .map((s) => {
        if (s.kind === 'static') return s.name;
        // Hono's `*` wildcard is not a named param; a regex param is.
        return s.kind === 'rest' ? `:${s.name}{.+}` : `:${s.name}`;
      })
      .join('/')
  );
}

/**
 * A URL-safe, stable key for the virtual module ids. Brackets would have to
 * survive a round trip through `/@id/...` and they are reserved characters.
 *
 * The separator must not be a dot. Vite decides whether to run a request
 * through its transform pipeline partly by extension, and `people._name` parses
 * as the extension `._name`, so dotted ids fall straight past the dev server and
 * get answered by the app as a 404 page. Silent, and only on nested routes.
 */
function idOf(parts) {
  return parts
    .map((part) =>
      part
        .replace(/^\[\.\.\.(.+)\]$/, '_$1_rest')
        .replace(/^\[(.+)\]$/, '_$1'),
    )
    .join('-');
}

// Static beats dynamic, dynamic beats catch-all, and among equals the longer
// path wins. Registration order then makes Hono's behaviour deterministic
// rather than something to reason about per-router.
function bySpecificity(a, b) {
  if (a.hasRest !== b.hasRest) return a.hasRest ? 1 : -1;
  if (a.params.length !== b.params.length) return a.params.length - b.params.length;
  if (a.segments.length !== b.segments.length) return b.segments.length - a.segments.length;
  return a.pattern.localeCompare(b.pattern);
}

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // `_` marks something that is not a route: helpers and drafts.
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.name.endsWith(EXT) || entry.name.endsWith(ENDPOINT_EXT)) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

/**
 * The routes directory, or a migration error.
 *
 * It was `pages/` until it started holding `.js` endpoints as well as `.html`
 * pages, at which point the name was no longer true. A missing directory otherwise
 * produces an empty route table and a site of 404s, which is a confusing way to
 * learn about a rename.
 *
 * @param {string} app the app directory
 * @param {string} routesDir from the config
 * @returns {string}
 * @throws when the old `pages/` name is still there
 */
export function resolveRoutesDir(app, routesDir) {
  const dir = path.resolve(app, routesDir);
  if (fs.existsSync(dir)) return dir;

  const legacy = path.resolve(app, 'pages');
  if (fs.existsSync(legacy)) {
    throw new Error(
      `[transclude] ${path.relative(app, legacy)}/ is now ${routesDir}/. It holds .js ` +
        `endpoints as well as .html pages. Rename the directory, or set ` +
        `\`routesDir\` in transclude.config.js.`,
    );
  }
  return dir;
}
