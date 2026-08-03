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
  compileElementsEntry,
  ELEMENTS_ENTRY,
  splitBlocks,
  usedComponents,
  readFlags,
} from './compiler/index.js';
import { resolveRoutesDir, scanRoutes } from './routes.js';
import { SERVER_FILE } from './server.js';

const P_COMPONENT = 'virtual:transclude-component/';
const P_PAGE = 'virtual:transclude-page/';
const P_CLIENT = 'virtual:transclude-client/';
const P_LAYOUT = 'virtual:transclude-layout/';
const SERVER_ENTRY = 'virtual:transclude-server';
const LAYOUT_FILE = '_layout.html';

const RUNTIME_FILE = fileURLToPath(new URL('./runtime/index.js', import.meta.url));

export default function transclude({
  appDir = 'app',
  elementsDir = 'elements',
  routesDir = 'routes',
  fragmentParam = 'fragment',
  watchElements = false,
} = {}) {
  // Off unless asked for. It puts a script on every page, and it only earns that
  // when swapped-in markup names an element the page did not already render.
  // A page that renders its own elements defines them without this.
  const watching = watchElements === true;
  let root;
  let app;
  let runtime;
  let components = new Map();
  let shadowTags = new Set();
  let pages = new Map();
  let endpoints = new Map();
  let layouts = new Map();
  // Virtual module id -> the .html file it came from, so relative imports inside
  // a <script> block resolve against the author's file rather than nowhere.
  const origin = new Map();

  const scan = () => {
    // One directory. An element is light unless its own file says otherwise,
    // which is read below rather than taken from where the file sits.
    components = readDir(path.resolve(app, elementsDir));

    const scanned = scanRoutes(resolveRoutesDir(app, routesDir));
    pages = new Map(
      [...scanned.routes, scanned.notFound, scanned.error]
        .filter(Boolean)
        .map((route) => [route.id, route]),
    );
    endpoints = new Map(scanned.endpoints.map((route) => [route.id, route]));
    // A dash keeps these valid custom element names. That is what makes a light element
    // an undefined custom element rather than an unknown one, and what lets its
    // styles be scoped to its own tag with no class or hash.
    for (const tag of [...components.keys()]) {
      if (!tag.includes('-')) {
        components.delete(tag);
        console.warn(`[transclude] ignoring ${tag}.html. Element names need a dash`);
      }
    }

    // How a tag renders decides how every file that mentions it compiles, so it
    // has to be known for all of them before any of them is compiled.
    shadowTags = new Set();
    for (const [tag, file] of components) {
      const flags = safely(() => readFlags(read(file), `${tag}.html`));
      if (flags?.shadow) shadowTags.add(tag);
    }

    layouts = scanLayouts(resolveRoutesDir(app, routesDir));

  };

  /**
   * Layouts that wrap a page, outermost first: every _layout.html from the routes
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

    // A light element with no script has nothing to define. It is markup that was
    // already rendered. A shadow one registers so it can re-render.
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
    const tags = componentClosure(seeds);
    return {
      tags,
      hasScript,
      // Asked by the dev server and by the build, which is the point: two copies
      // of this rule is two servers that disagree about which pages ship JS.
      //
      // Elements to define or script to run, and otherwise nothing at all. The
      // exception is fragments, where any page can be swapped into and needs the
      // loader that defines whatever arrives.
      needed: watching || tags.length > 0 || hasScript,
    };
  };

  const report = (label, warnings) => {
    for (const w of warnings ?? []) console.warn(`[transclude] ${label}: ${w}`);
  };

  return {
    name: 'transclude',
    enforce: 'pre',

    // Read by the build script: it needs the route table and which routes ship
    // client JS before it can decide the rollup inputs.
    api: {
      manifest() {
        if (!root) throw new Error('[transclude] plugin not configured yet');
        const scanned = scanRoutes(resolveRoutesDir(app, routesDir));
        return {
          routes: scanned.routes.map((route) => ({
            id: route.id,
            pattern: route.pattern,
            rel: route.rel,
            params: route.params,
            client: clientManifest(route),
          })),
          // No client entry, no prerendering, no layouts. An endpoint is a route
          // and nothing else.
          endpoints: scanned.endpoints.map((route) => ({
            id: route.id,
            pattern: route.pattern,
            rel: route.rel,
            params: route.params,
          })),
          notFound: scanned.notFound
            ? { id: scanned.notFound.id, rel: scanned.notFound.rel, params: [], client: clientManifest(scanned.notFound) }
            : null,
          error: scanned.error
            ? { id: scanned.error.id, rel: scanned.error.rel, params: [], client: clientManifest(scanned.error) }
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
      if (id === SERVER_ENTRY || id === ELEMENTS_ENTRY) return '\0' + id;
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
      if (importer?.startsWith('\0virtual:transclude-') && /^\.\.?\//.test(id)) {
        const source = origin.get(importer);
        if (source) return path.resolve(path.dirname(source), id);
      }
      return null;
    },

    load(id) {
      if (!id.startsWith('\0virtual:transclude-')) return null;
      const virt = id.slice(1);

      // Every element in the app, not only the ones some page renders: a
      // fragment can name any of them, and which one it names is a runtime fact.
      if (virt === ELEMENTS_ENTRY) return compileElementsEntry(components.keys()).code;

      // One module that pulls in every page, so the SSR build is a single graph.
      // The app's middleware comes through here too rather than being imported
      // from source at runtime: the production server reads `dist` and nothing
      // else, which is what makes its "your source is newer than this build"
      // warning true.
      if (virt === SERVER_ENTRY) {
        const ids = [...pages.keys()];
        const serverFile = path.resolve(app, SERVER_FILE);
        const hasMiddleware = fs.existsSync(serverFile);
        const specifier = '/' + path.relative(root, serverFile).split(path.sep).join('/');

        // An endpoint is already a module. It needs no compiling, only pulling
        // into the same graph, so production reads it from `dist` like everything
        // else rather than importing app source at runtime.
        const apiIds = [...endpoints.keys()];
        const apiSpec = (route) =>
          JSON.stringify('/' + path.relative(root, route.file).split(path.sep).join('/'));

        return `
${ids.map((pageId, i) => `import * as __P${i} from ${JSON.stringify(`${P_PAGE}${pageId}`)};`).join('\n')}
${apiIds.map((apiId, i) => `import * as __E${i} from ${apiSpec(endpoints.get(apiId))};`).join('\n')}
${hasMiddleware ? `import __middleware from ${JSON.stringify(specifier)};` : ''}

export const pages = {
${ids.map((pageId, i) => `  ${JSON.stringify(pageId)}: __P${i},`).join('\n')}
};

export const endpoints = {
${apiIds.map((apiId, i) => `  ${JSON.stringify(apiId)}: __E${i},`).join('\n')}
};

export const middleware = ${hasMiddleware ? '__middleware ?? null' : 'null'};
`;
      }

      if (virt.startsWith(P_COMPONENT)) {
        const tag = virt.slice(P_COMPONENT.length);
        const file = components.get(tag);
        if (!file) throw new Error(`[transclude] no element <${tag}> in ${elementsDir}`);
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
        if (!file) throw new Error(`[transclude] no layout "${layoutId}"`);
        origin.set(id, file);
        const out = compileLayout(read(file), { id: layoutId, components, shadowTags, runtime });
        report(`${layoutId} layout`, out.warnings);
        return out.code;
      }

      if (virt.startsWith(P_PAGE)) {
        const name = virt.slice(P_PAGE.length);
        const route = pages.get(name);
        if (!route) throw new Error(`[transclude] no page "${name}" in ${routesDir}`);
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
      if (!route) throw new Error(`[transclude] no page "${name}" in ${routesDir}`);
      origin.set(id, route.file);
      const sources = [
        ...chainFor(route).map((l) => ({ source: read(l.file), filename: `${l.id}/_layout.html` })),
        { source: read(route.file), filename: route.rel },
      ];
      return compileClientEntry(sources, clientManifest(route), {
        runtime,
        elements: watching,
      }).code;
    },

    configureServer(server) {
      server.watcher.on('all', (_event, file) => {
        if (!file.endsWith('.html')) return;
        if (!file.startsWith(app)) return;

        scan();
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id?.startsWith('\0virtual:transclude-')) server.moduleGraph.invalidateModule(mod);
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
/** `routes/_layout.html` -> "root", `routes/people/_layout.html` -> "people". */
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

// A broken file should not take the whole type pass down with it. The module load
// for that file will report the real error.
function safely(fn) {
  try {
    return fn();
  } catch {
    return { kind: 'unknown' };
  }
}
