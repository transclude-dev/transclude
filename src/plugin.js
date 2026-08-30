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
  frameOf,
  splitBlocks,
  usedComponents,
  readBehavior,
  readFlags,
} from './compiler/index.js';
import { resolveRoutesDir, scanRoutes } from './routes.js';
import { MARKDOWN_EXT, sourceOf } from './markdown.js';
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
  publicDir = 'public',
  fragmentParam = 'fragment',
  watchElements = false,
  markdown = null,
} = {}) {
  // Off unless asked for. It puts a script on every page, and it only earns that
  // when swapped-in markup names an element the page did not already render.
  // A page that renders its own elements defines them without this.
  const watching = watchElements === true;

  // Every compile in this file goes through here, so a `.md` page reaches the
  // compiler as HTML and nothing downstream learns a second format.
  const read = (file) => sourceOf(file, readRaw(file), markdown);

  let root;
  let publicRoot = null;
  let serving = false;
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
        return Boolean(safely(() => readBehavior(read(components.get(tag))))?.behavior);
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
      // Two kinds of file reach this loop, and each ships JavaScript for its own
      // reason. A page's `<script>` is its client entry. An element ships a
      // definition when it has behavior to attach, and nothing when it does not,
      // because then it is markup that was already rendered.
      const blocks = safely(() => splitBlocks(source));
      if (blocks?.client?.some((block) => block.code.trim())) hasScript = true;
      if (safely(() => readBehavior(source))?.behavior) hasScript = true;
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

  /** The 404 or the 500 page, as the manifest holds it, or null if there is none. */
  const errorPageEntry = (route) => {
    if (!route) return null;
    return { id: route.id, rel: route.rel, params: [], client: clientManifest(route) };
  };

  const report = (label, warnings) => {
    for (const w of warnings ?? []) console.warn(`[transclude] ${label}: ${w}`);
  };

  // The bins pass this plugin to Vite themselves, and Vite merges a project's
  // own `vite.config.js` rather than deduping, so a project that registers it
  // again gets two: the second scans the app a second time and adds a second
  // dev watcher, which reloads the browser twice for one edit. `api` is the one
  // thing Vite keeps by reference when it copies a plugin, so it is how an
  // instance recognizes itself in the resolved list.
  let duplicate = false;

  /**
   * A compile, with the position attached in the shape Vite draws.
   *
   * A `CompileError` knows its line and column and nothing about which file it
   * came from: the compiler is handed a source, not a path. Vite renders `loc`
   * and `frame` into the overlay and the terminal, so filling them in here is
   * the difference between a sentence about line 4 and a picture of line 4.
   *
   * @param {string} source what was compiled, for the frame
   * @param {string} file the path an editor can open
   * @param {Function} run the compile
   */
  const compiling = (source, file, run) => {
    try {
      return run();
    } catch (err) {
      if (err?.name !== 'CompileError' || !err.line) throw err;
      err.loc = { file, line: err.line, column: err.column ?? 1 };
      err.frame = frameOf(source, err.line, err.column);
      throw err;
    }
  };

  const plugin = {
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
          // Neither is a route: both are reached for rather than matched, so
          // they carry no pattern and no params.
          notFound: errorPageEntry(scanned.notFound),
          error: errorPageEntry(scanned.error),
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
      duplicate = config.plugins.find((p) => p.name === 'transclude')?.api !== plugin.api;
      if (duplicate) return;

      root = config.root;
      app = path.resolve(root, appDir);
      publicRoot = publicDir ? path.resolve(app, publicDir) : null;
      serving = config.command === 'serve';
      runtime = '/' + path.relative(root, RUNTIME_FILE).split(path.sep).join('/');
      scan();
    },

    resolveId(id, importer) {
      if (duplicate) return null;
      // No '\0' prefix, on purpose. The convention marks a virtual id, and
      // rolldown leaves '\0' modules out of the map it composes for a bundle,
      // so `dist/server/entry.js.map` listed no page at all and a prerender
      // failure could name no .html. Measured on Vite 8.2.1: with the prefix,
      // no page is a source; without it, every page is. Resolution still ends
      // here, because this hook answers for these ids before anything else.
      if (id === SERVER_ENTRY || id === ELEMENTS_ENTRY) return id;
      if (
        id.startsWith(P_COMPONENT) ||
        id.startsWith(P_PAGE) ||
        id.startsWith(P_CLIENT) ||
        id.startsWith(P_LAYOUT)
      ) {
        return id;
      }
      // A virtual module has no directory, so Vite cannot resolve `../data/x.js`
      // on its own. The block was authored in a real file; use that file's dir.
      if (importer?.startsWith('virtual:transclude-') && /^\.\.?\//.test(id)) {
        const source = origin.get(importer);
        if (source) return path.resolve(path.dirname(source), id);
      }

      // Where a public file is, when dev asks. `dev.js` passes `publicDir: false`
      // so Hono serves these the same way in dev as in production, and the cost
      // is that Vite no longer knows they exist. `transformIndexHtml` scans a
      // page for `<script type="module" src>` and warms each one, so a page with
      // `<script src="/theme.js" type="module">` logged
      // "Failed to load url /theme.js. Does the file exist?" on every request.
      // It does exist, it is served, and the page works. A warning that is wrong
      // every time is read as decoration.
      //
      // Answering with the file is what ends the warmup quietly. Nothing uses
      // what it produces: the browser asks for `/theme.js` and Hono answers with
      // the bytes, exactly as production does. Serve only, because in a build
      // this same id would make rolldown bundle a public file as a module, and
      // the build already copies it.
      if (serving && publicRoot && id.startsWith('/') && !id.startsWith('/@')) {
        const asset = path.join(publicRoot, id.slice(1));
        // Inside the directory, not merely prefixed by its name: `/public-x` is
        // not in `public/`, and `..` in a URL must not walk out of it.
        const inside = asset.startsWith(publicRoot + path.sep);
        if (inside && fs.existsSync(asset) && fs.statSync(asset).isFile()) return asset;
      }
      return null;
    },

    load(id) {
      if (duplicate) return null;
      if (!id.startsWith('virtual:transclude-')) return null;
      const virt = id;

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
${hasMiddleware ? `import * as __server from ${JSON.stringify(specifier)};` : ''}

export const pages = {
${ids.map((pageId, i) => `  ${JSON.stringify(pageId)}: __P${i},`).join('\n')}
};

export const endpoints = {
${apiIds.map((apiId, i) => `  ${JSON.stringify(apiId)}: __E${i},`).join('\n')}
};

export const middleware = ${hasMiddleware ? '__server.default ?? null' : 'null'};

// Paths the app says are not public. The build reads this and writes no file for
// them, because middleware does not run during a build and a file it was meant
// to gate would be served by any static host.
export const gated = ${hasMiddleware ? '__server.gated ?? []' : '[]'};
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
        const body = read(file);
        const out = compiling(body, file, () => compileComponent(body, {
          tag,
          shadow: shadowTags.has(tag),
          components,
          shadowTags,
          runtime,
          filename: tag,
          nested,
        }));
        report(tag, out.warnings);
        return out.code;
      }

      if (virt.startsWith(P_LAYOUT)) {
        const layoutId = virt.slice(P_LAYOUT.length);
        const file = layouts.get(layoutId);
        if (!file) throw new Error(`[transclude] no layout "${layoutId}"`);
        origin.set(id, file);
        // `sourcePath` absolute for the same reason as the page's below.
        const out = compileLayout(read(file), {
          id: layoutId,
          components,
          shadowTags,
          runtime,
          sourcePath: file,
        });
        report(`${layoutId} layout`, out.warnings);
        return out.map ? { code: out.code, map: out.map } : out.code;
      }

      if (virt.startsWith(P_PAGE)) {
        const name = virt.slice(P_PAGE.length);
        const route = pages.get(name);
        if (!route) throw new Error(`[transclude] no page "${name}" in ${routesDir}`);
        origin.set(id, route.file);
        const pageBody = read(route.file);
        const out = compiling(pageBody, route.file, () => compilePage(pageBody, {
          components,
          shadowTags,
          runtime,
          filename: name,
          // Absolute, not relative to the project. A bundler composing this map
          // into its own resolves `sources` against the *output* directory, so a
          // repo-relative path came out as `dist/server/app/routes/…` and the
          // stack named whichever file that collided with.
          sourcePath: route.file,
          layouts: chainFor(route),
          client: clientManifest(route),
        }));
        report(name, out.warnings);
        // The map goes back with it. Vite composes what a load hook returns; a
        // comment on the code is not read, so a stack named the virtual module.
        return out.map ? { code: out.code, map: out.map } : out.code;
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
      if (duplicate) return;

      server.watcher.on('all', (_event, file) => {
        if (!file.endsWith('.html') && !file.endsWith(MARKDOWN_EXT)) return;
        if (!file.startsWith(app)) return;

        scan();
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id?.startsWith('virtual:transclude-')) server.moduleGraph.invalidateModule(mod);
        }
        const hot = server.hot ?? server.ws;
        hot?.send({ type: 'full-reload' });
      });
    },
  };

  return plugin;
}

/**
 * Browser URL for a virtual module id.
 *
 * No `__x00__`, because the ids carry no '\0' prefix. That encoding is Vite's
 * spelling of the prefix in a URL, and with it here the browser asked for a
 * module the graph no longer holds, on every page that ships JS, in dev only.
 *
 * @param {string} page the route id
 * @returns {string} the URL Vite serves its entry from
 */
export function clientEntryUrl(page) {
  return `/@id/${P_CLIENT}${page}`;
}

/**
 * @param {string} page
 * @returns {string} the virtual module id for that page
 */
export function pageModuleId(page) {
  return `${P_PAGE}${page}`;
}

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

function readRaw(file) {
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
