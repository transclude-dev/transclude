// Vite plugin. Everything is exposed as a virtual module id rather than a real
// .html path: Vite's own html middleware would otherwise intercept requests for
// /src/components/user-card.html and serve it as a page.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileComponent,
  compileLayout,
  compilePage,
  compileClientEntry,
  splitBlocks,
  usedComponents,
} from './compiler/index.js';
import { scanRoutes } from './routes.js';

const P_COMPONENT = 'virtual:hf-component/';
const P_PAGE = 'virtual:hf-page/';
const P_CLIENT = 'virtual:hf-client/';
const P_LAYOUT = 'virtual:hf-layout/';
const SERVER_ENTRY = 'virtual:hf-server';
const LAYOUT_FILE = '_layout.html';

const RUNTIME_FILE = fileURLToPath(new URL('./runtime/index.js', import.meta.url));

export default function htmlFirst({
  appDir = 'app',
  componentsDir = 'components',
  partialsDir = 'partials',
  pagesDir = 'pages',
} = {}) {
  let root;
  let app;
  let runtime;
  let components = new Map();
  let shadowTags = new Set();
  let pages = new Map();
  let layouts = new Map();
  // Virtual module id -> the .html file it came from, so relative imports inside
  // a <script> block resolve against the author's file rather than nowhere.
  const origin = new Map();

  const scan = () => {
    // Two directories, because they are two things you reach for at different
    // moments. Which rendering an element gets is decided here and nowhere else.
    const shadow = readDir(path.resolve(app, componentsDir));
    const light = readDir(path.resolve(app, partialsDir));
    components = new Map([...light, ...shadow]);

    const scanned = scanRoutes(path.resolve(app, pagesDir));
    pages = new Map(
      [...scanned.routes, scanned.notFound]
        .filter(Boolean)
        .map((route) => [route.id, route]),
    );
    // A dash keeps these valid custom element names — which is what makes a
    // partial an *undefined* custom element rather than an unknown one, and what
    // lets its styles be scoped to its own tag with no class or hash.
    for (const tag of [...components.keys()]) {
      if (!tag.includes('-')) {
        components.delete(tag);
        console.warn(`[html-first] ignoring ${tag}.html — element names need a dash`);
      }
    }

    shadowTags = new Set([...shadow.keys()].filter((tag) => components.has(tag)));

    // One tag, one meaning — otherwise the component silently wins and the
    // partial never renders.
    for (const tag of shadow.keys()) {
      if (!light.has(tag)) continue;
      throw new Error(
        `[html-first] <${tag}> is both a component and a partial ` +
          `(${componentsDir}/${tag}.html and ${partialsDir}/${tag}.html) — rename one`,
      );
    }

    layouts = scanLayouts(path.resolve(app, pagesDir));

  };

  /**
   * Layouts that wrap a page, outermost first: every _layout.html from the pages
   * root down to the page's own directory.
   */
  const chainFor = (route) => {
    const dirs = path.dirname(route.rel).split(path.sep).filter((d) => d && d !== '.');
    const chain = [];
    for (let i = 0; i <= dirs.length; i++) {
      const id = i === 0 ? 'root' : dirs.slice(0, i).join('-');
      if (layouts.has(id)) chain.push({ id, file: layouts.get(id) });
    }
    return chain;
  };

  /**
   * Every component the page can end up rendering, including ones only reached
   * through another component: a re-render produces its children's markup too,
   * and those need their definitions to upgrade.
   */
  const componentClosure = (seeds) => {
    const out = new Set();
    const queue = [...seeds];
    while (queue.length) {
      const tag = queue.pop();
      if (out.has(tag) || !components.has(tag)) continue;
      out.add(tag);
      for (const nested of safely(() => usedComponents(read(components.get(tag)), components)) ?? []) {
        queue.push(nested);
      }
    }

    // A light element with no script has nothing to define — it is markup that
    // was already rendered. A shadow one registers so it can re-render.
    return [...out]
      .filter((tag) => {
        if (shadowTags.has(tag)) return true;
        const blocks = safely(() => splitBlocks(read(components.get(tag))));
        return Boolean(blocks?.client?.some((block) => block.code.trim()));
      })
      .sort();
  };

  const clientManifest = (route) => {
    const files = [...chainFor(route).map((l) => l.file), route.file];
    const seeds = new Set();
    let hasScript = false;

    const queue = [...files];
    const visited = new Set();
    while (queue.length) {
      const file = queue.pop();
      if (visited.has(file)) continue;
      visited.add(file);

      const source = read(file);
      // A light element renders inline, so anything it uses is reached through
      // it and still needs its own definition.
      for (const tag of safely(() => usedComponents(source, components)) ?? []) {
        seeds.add(tag);
        if (!shadowTags.has(tag) && components.has(tag)) queue.push(components.get(tag));
      }
      // The block splitter already separates client <script> from server/props.
      const blocks = safely(() => splitBlocks(source));
      if (blocks?.client?.some((block) => block.code.trim())) hasScript = true;
    }
    return { tags: componentClosure(seeds), hasScript };
  };

  const report = (label, warnings) => {
    for (const w of warnings ?? []) console.warn(`[html-first] ${label}: ${w}`);
  };

  return {
    name: 'html-first',
    enforce: 'pre',

    // Read by the build script: it needs the route table and which routes ship
    // client JS before it can decide the rollup inputs.
    api: {
      manifest() {
        if (!root) throw new Error('[html-first] plugin not configured yet');
        const scanned = scanRoutes(path.resolve(app, pagesDir));
        return {
          routes: scanned.routes.map((route) => ({
            id: route.id,
            pattern: route.pattern,
            rel: route.rel,
            params: route.params,
            client: clientManifest(route),
          })),
          notFound: scanned.notFound
            ? { id: scanned.notFound.id, rel: scanned.notFound.rel, params: [], client: clientManifest(scanned.notFound) }
            : null,
        };
      },
      configure(config) {
        root = config.root;
        app = path.resolve(root, appDir);
        runtime = '/' + path.relative(root, RUNTIME_FILE).split(path.sep).join('/');
        scan();
      },
    },

    configResolved(config) {
      root = config.root;
      app = path.resolve(root, appDir);
      runtime = '/' + path.relative(root, RUNTIME_FILE).split(path.sep).join('/');
      scan();
    },

    resolveId(id, importer) {
      if (id === SERVER_ENTRY) return '\0' + id;
      if (
        id.startsWith(P_COMPONENT) ||
        id.startsWith(P_PAGE) ||
        id.startsWith(P_CLIENT) ||
        id.startsWith(P_LAYOUT)
      ) {
        return '\0' + id;
      }
      // A virtual module has no directory, so Vite cannot resolve `../data/x.js`
      // on its own. The block was authored in a real file; use that file's dir.
      if (importer?.startsWith('\0virtual:hf-') && /^\.\.?\//.test(id)) {
        const source = origin.get(importer);
        if (source) return path.resolve(path.dirname(source), id);
      }
      return null;
    },

    load(id) {
      if (!id.startsWith('\0virtual:hf-')) return null;
      const virt = id.slice(1);

      // One module that pulls in every page, so the SSR build is a single graph.
      if (virt === SERVER_ENTRY) {
        const ids = [...pages.keys()];
        return `
${ids.map((pageId, i) => `import * as __P${i} from ${JSON.stringify(`${P_PAGE}${pageId}`)};`).join('\n')}

export const pages = {
${ids.map((pageId, i) => `  ${JSON.stringify(pageId)}: __P${i},`).join('\n')}
};
`;
      }

      if (virt.startsWith(P_COMPONENT)) {
        const tag = virt.slice(P_COMPONENT.length);
        const file = components.get(tag);
        if (!file) throw new Error(`[html-first] no component <${tag}> in ${componentsDir}`);
        origin.set(id, file);
        // The donut: a light element's styles stop at any light element nested
        // inside it.
        const inner = [...(safely(() => usedComponents(read(file), components)) ?? [])];
        const nested = inner.filter((child) => !shadowTags.has(child));
        const out = compileComponent(read(file), {
          tag,
          shadow: shadowTags.has(tag),
          components,
          shadowTags,
          runtime,
          filename: tag,
          nested,
        });
        report(tag, out.warnings);
        return out.code;
      }

      if (virt.startsWith(P_LAYOUT)) {
        const layoutId = virt.slice(P_LAYOUT.length);
        const file = layouts.get(layoutId);
        if (!file) throw new Error(`[html-first] no layout "${layoutId}"`);
        origin.set(id, file);
        const out = compileLayout(read(file), { id: layoutId, components, shadowTags, runtime });
        report(`${layoutId} layout`, out.warnings);
        return out.code;
      }

      if (virt.startsWith(P_PAGE)) {
        const name = virt.slice(P_PAGE.length);
        const route = pages.get(name);
        if (!route) throw new Error(`[html-first] no page "${name}" in ${pagesDir}`);
        origin.set(id, route.file);
        const out = compilePage(read(route.file), {
          components,
          shadowTags,
          runtime,
          filename: name,
          layouts: chainFor(route),
          client: clientManifest(route),
        });
        report(name, out.warnings);
        return out.code;
      }

      const name = virt.slice(P_CLIENT.length);
      const route = pages.get(name);
      if (!route) throw new Error(`[html-first] no page "${name}" in ${pagesDir}`);
      origin.set(id, route.file);
      const sources = [
        ...chainFor(route).map((l) => ({ source: read(l.file), filename: `${l.id}/_layout.html` })),
        { source: read(route.file), filename: route.rel },
      ];
      return compileClientEntry(sources, clientManifest(route)).code;
    },

    configureServer(server) {
      server.watcher.on('all', (_event, file) => {
        if (!file.endsWith('.html')) return;
        if (!file.startsWith(app)) return;

        scan();
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id?.startsWith('\0virtual:hf-')) server.moduleGraph.invalidateModule(mod);
        }
        const hot = server.hot ?? server.ws;
        hot?.send({ type: 'full-reload' });
      });
    },
  };
}

/** Browser URL for a virtual module id. */
export function clientEntryUrl(page) {
  return `/@id/__x00__${P_CLIENT}${page}`;
}

export function pageModuleId(page) {
  return `${P_PAGE}${page}`;
}


/** Bare specifier resolution, walking up node_modules the way Node does. */
function resolveBare(fromDir, specifier) {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const rest = specifier.slice(name.length).replace(/^\//, '');
  const subpath = rest ? `./${rest}` : '.';

  let dir = fromDir;
  for (;;) {
    const pkgDir = path.join(dir, 'node_modules', name);
    const manifest = path.join(pkgDir, 'package.json');

    if (fs.existsSync(manifest)) {
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      } catch {
        return null;
      }

      // `exports` is exhaustive when present: a subpath it does not describe is
      // not reachable, and falling back to main would resolve what Node would
      // refuse to.
      if (pkg.exports !== undefined) {
        const target = resolveExports(pkg.exports, subpath);
        return target ? existingFile(path.join(pkgDir, target)) : null;
      }

      if (subpath !== '.') return existingFile(path.join(pkgDir, rest));
      const legacy = pkg.module ?? pkg.main;
      return legacy ? existingFile(path.join(pkgDir, legacy)) : existingFile(path.join(pkgDir, 'index'));
    }

    if (fs.existsSync(pkgDir)) return existingFile(path.join(pkgDir, rest || 'index'));

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The `exports` field: condition objects, subpath maps, `*` patterns, arrays of
 * alternatives, and `null` to block a path. Conditions nest arbitrarily, so
 * picking one is recursive rather than a couple of `??`s.
 */
/** `pages/_layout.html` -> "root", `pages/people/_layout.html` -> "people". */
function scanLayouts(dir, base = dir, out = new Map()) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) scanLayouts(full, base, out);
    } else if (entry.name === LAYOUT_FILE) {
      const rel = path.relative(base, dir);
      out.set(rel ? rel.split(path.sep).join('-') : 'root', full);
    }
  }
  return out;
}

function readDir(dir) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.html')) map.set(entry.slice(0, -5), path.join(dir, entry));
  }
  return map;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

// A broken file should not take the whole type pass down with it — the module
// load for that file will report the real error.
function safely(fn) {
  try {
    return fn();
  } catch {
    return { kind: 'unknown' };
  }
}
