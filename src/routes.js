// File-based routing. The directory tree is the route table; Hono does the
// matching. Pure functions only — the plugin and the server both scan, and they
// must not be able to disagree.
//
//   pages/index.html            ->  /
//   pages/about.html            ->  /about
//   pages/blog/index.html       ->  /blog
//   pages/blog/[slug].html      ->  /blog/:slug
//   pages/docs/[...path].html   ->  /docs/:path{.+}
//   pages/404.html              ->  the not-found handler, not a route
//   pages/_partial.html         ->  ignored, as is anything under an _ directory

import fs from 'node:fs';
import path from 'node:path';

const EXT = '.html';
const NOT_FOUND = '404';

export function scanRoutes(dir) {
  const routes = [];
  let notFound = null;

  const seen = new Map();
  for (const rel of walk(dir)) {
    const route = toRoute(rel, path.join(dir, rel));

    if (route.id === NOT_FOUND) {
      notFound = route;
      continue;
    }
    const clash = seen.get(route.pattern) ?? seen.get(route.id);
    if (clash) {
      throw new Error(
        `[html-first] ${rel} and ${clash} collide (${route.pattern}, id ${route.id}) — rename one`,
      );
    }
    seen.set(route.pattern, rel);
    seen.set(route.id, rel);
    routes.push(route);
  }

  routes.sort(bySpecificity);
  return { routes, notFound };
}

export function toRoute(rel, file) {
  const parts = rel.slice(0, -EXT.length).split(path.sep);

  // `blog/index.html` and `blog.html` both mean /blog; the trailing `index`
  // is addressing, not a path segment.
  const named = parts.at(-1) === 'index' ? parts.slice(0, -1) : parts;
  const segments = named.map(parseSegment);

  return {
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
 * as the extension `._name` — so dotted ids fall straight past the dev server
 * and get answered by the app as a 404 page. Silent, and only on nested routes.
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
    // `_` marks something that is not a route: partials, helpers, drafts.
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.name.endsWith(EXT)) out.push(path.relative(base, full));
  }
  return out;
}
