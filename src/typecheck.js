// Type checking and type extraction, both by TypeScript.
//
// Shims live in memory at `<file>.html.js`, never on disk. Naming them after the
// source file is what makes their relative imports resolve the way the author
// wrote them. A shim in a parallel directory would have to rewrite every import,
// and rewriting is where source mapping breaks down.
//
// JavaScript rather than TypeScript because a JSDoc `@type` in the author's own
// `<script props>` is honored in a .js file and silently ignored in a .ts one.
//
// Shims are self-contained: route contexts and component props are inlined as
// type literals rather than imported. transclude-env.d.ts is written *from* the shims,
// so it cannot also be an input to them.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { AMBIENT_NAMES } from './compiler/ambient.js';
import { buildEndpointShim, buildShim, originalOffset } from './compiler/shim.js';
import { splitBlocks, readFlags } from './compiler/index.js';
import { resolveRoutesDir, scanRoutes } from './routes.js';

/**
 * Annotations are optional, so `noImplicitAny` is off: an unannotated parameter
 * is `any` rather than an error, and the author writes plain modern JavaScript.
 * That would normally allow reading an undeclared property on a type that came
 * from an object literal. The shim gets that back by remapping the keys, so
 * `${user.nmae}` is still an error.
 *
 * `strictNullChecks` stays on: `querySelector` really can return null, and that
 * is a bug rather than a matter of taste. `strict: true` in the config turns the
 * rest on for anyone who wants it.
 */
const compilerOptions = (strict) => ({
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
  strict,
  strictNullChecks: true,
  noImplicitAny: strict,
  noEmit: true,
  skipLibCheck: true,
  allowJs: true,
  checkJs: true,
  types: [],
});

// `UseFullyQualifiedType` is what makes a name the app declared resolvable
// somewhere else. Without it a `@typedef {…} Post` in the app prints as `Post`,
// which means something in the file it came from and nothing in
// transclude-env.d.ts, where it landed as an undeclared name.
const TYPE_FORMAT =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.InTypeAlias |
  ts.TypeFormatFlags.UseFullyQualifiedType |
  ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;

const LAYOUT_FILE = '_layout.html';

/**
 * The checker, and everything it needs held in one closure.
 *
 * This is long and stays long: every helper below reads the language service,
 * the shim map or the resolved project, and handing each of them five arguments
 * instead would be more to read rather than less. It is a list of small named
 * functions, in this order:
 *
 *   the language service     host, install, sourceOf
 *   reading a type back      exportTypeOf, expand, resolveNames, and the four
 *                            `…TypeOf` shorthands
 *   finding the project      elementFiles, layoutFiles, ancestorsOf, chainFor
 *   what a shim is given     contextLiteral, endpointLiteral, mergeTypes
 *   building them            build, refresh
 *   what callers use         the returned object
 *
 * `build` is the one to read first. It compiles every shim in dependency order,
 * which is the only order that resolves: an element depends on nothing, a layout
 * on the layouts above it, a page on its whole chain.
 *
 * @param {{ root: string, appDir: string, routesDir: string, elementsDir: string,
 *   strict?: boolean }} options
 * @returns {{ files: Function, update: Function, rebuild: Function,
 *   check: Function, quickInfo: Function, describe: Function }}
 */
export function createChecker({
  root,
  appDir = 'app',
  elementsDir = 'elements',
  routesDir = 'routes',
  strict = false,
}) {
  const app = path.resolve(root, appDir);
  const options = compilerOptions(Boolean(strict));
  const shims = new Map();
  const versions = new Map();
  const overlays = new Map();

  const shimPath = (file) => `${file}.js`;

  const host = {
    getScriptFileNames: () => [...shims.keys()],
    getScriptVersion: (name) => String(versions.get(name) ?? 0),
    getScriptSnapshot: (name) => {
      const shim = shims.get(name);
      if (shim) return ts.ScriptSnapshot.fromString(shim.code);
      if (!fs.existsSync(name)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(name, 'utf8'));
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (name) => shims.has(name) || ts.sys.fileExists(name),
    readFile: (name) => (shims.has(name) ? shims.get(name).code : ts.sys.readFile(name)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  const install = (file, built) => {
    const name = shimPath(file);
    shims.set(name, built);
    versions.set(name, (versions.get(name) ?? 0) + 1);
    return built;
  };

  const sourceOf = (file) => overlays.get(file) ?? fs.readFileSync(file, 'utf8');

  /** The type of one of a shim's marker exports. What tsc made of the file. */
  const exportTypeOf = (file, name) => {
    const program = service.getProgram();
    const source = program?.getSourceFile(shimPath(file));
    if (!source) return 'unknown';

    const checker = program.getTypeChecker();
    const moduleSymbol = checker.getSymbolAtLocation(source);
    const data =
      moduleSymbol &&
      checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.getName() === name);
    if (!data) return 'unknown';

    const type = checker.getTypeOfSymbolAtLocation(data, data.valueDeclaration ?? source);
    const text = checker.typeToString(type, undefined, TYPE_FORMAT);
    return text === 'any' ? 'unknown' : text;
  };

  // `UseFullyQualifiedType` prints a named type as `import("/abs/file").Name`.
  // Inside a shim that resolves and is what keeps a prop structurally checked.
  // In transclude-env.d.ts it does not: a shim path is `<file>.js` for an .html
  // file nobody can import, and an absolute path would name this machine.
  const QUALIFIED = /import\("([^"]+)"\)\.([A-Za-z_$][\w$]*)/g;

  /**
   * The type a name stands for, expanded. `InTypeAlias` is what stops tsc
   * printing the alias for the type it was asked to print, so this returns the
   * shape rather than the name again. A type naming itself terminates: the
   * placeholder is in place before the expansion is resolved.
   */
  const expand = (file, name, into) => {
    const key = `${file}\0${name}`;
    const already = into.byKey.get(key);
    if (already) return already;

    const program = service.getProgram();
    // tsc prints the path with no extension, and a shim is the source it names
    // plus `.js`.
    const source = program?.getSourceFile(file) ?? program?.getSourceFile(`${file}.js`);
    const checker = program?.getTypeChecker();
    const moduleSymbol = source && checker?.getSymbolAtLocation(source);
    const symbol =
      moduleSymbol && checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === name);
    // Two files can each declare a `Post`, and one name cannot mean both.
    let display = name;
    for (let n = 2; into.text.has(display); n++) display = `${name}_${n}`;
    if (!symbol) return display;

    into.byKey.set(key, display);
    into.text.set(display, '');
    const declared = checker.getDeclaredTypeOfSymbol(symbol);
    into.text.set(display, resolveNames(checker.typeToString(declared, undefined, TYPE_FORMAT), into));
    return display;
  };

  /**
   * Every qualified name in a type string, replaced by a bare one. What the
   * compiler declares for itself is left to the emitted file, which writes the
   * same shapes from `ambient.js`; anything else is the app's and is expanded.
   */
  const resolveNames = (type, into) =>
    type.replace(QUALIFIED, (_, file, name) =>
      AMBIENT_NAMES.has(name) ? name : expand(file, name, into),
    );

  const dataTypeOf = (file) => exportTypeOf(file, '__data');
  const propTypeOf = (file) => exportTypeOf(file, '__propTypes');
  const memberTypeOf = (file) => exportTypeOf(file, '__members');
  const stateTypeOf = (file) => exportTypeOf(file, '__state');

  // ---- the project, in the only order that resolves ------------------------

  const elementFiles = (dir) =>
    readDirSafe(path.resolve(app, dir))
      .filter((entry) => entry.endsWith('.html') && entry.slice(0, -5).includes('-'))
      .map((entry) => path.resolve(app, dir, entry));

  const componentFiles = () => elementFiles(elementsDir);

  // The file decides whether the element has a shadow root, so it also decides
  // what `this.shadowRoot` means inside its <script>. Read with the compiler's
  // own reader, or the types would describe a different element than the one
  // that ships.
  const isShadow = (file) => Boolean(safeFlags(file).shadow);

  const safeFlags = (file) => {
    try {
      return readFlags(fs.readFileSync(file, 'utf8'), path.basename(file));
    } catch {
      // A file that will not parse is reported by the checker itself. Guessing
      // light here only decides which shim shape it gets while that is fixed.
      return {};
    }
  };

  const layoutFiles = (dir = resolveRoutesDir(app, routesDir), out = new Map()) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) layoutFiles(full, out);
      else if (entry.name === LAYOUT_FILE) {
        const relative = path.relative(resolveRoutesDir(app, routesDir), dir);
        out.set(relative ? relative.split(path.sep).join('-') : 'root', full);
      }
    }
    return out;
  };

  const ancestorsOf = (layoutId, layouts) => {
    const parts = layoutId === 'root' ? [] : layoutId.split('-');
    const chain = [];
    for (let i = 0; i <= parts.length; i++) {
      const id = i === 0 ? 'root' : parts.slice(0, i).join('-');
      if (layouts.has(id) && id !== layoutId) chain.push(id);
    }
    return chain;
  };

  const chainFor = (rel, layouts) => {
    const dirs = path.dirname(rel).split(path.sep).filter((d) => d && d !== '.');
    const chain = [];
    for (let i = 0; i <= dirs.length; i++) {
      const id = i === 0 ? 'root' : dirs.slice(0, i).join('-');
      if (layouts.has(id)) chain.push(id);
    }
    return chain;
  };

  /** Later wins, which is what a nearer layout should do. */
  const mergeTypes = (types) =>
    types
      .filter((type) => type && type !== 'unknown')
      .reduce(
        (left, right) => (left === '{}' ? right : `Omit<${left}, keyof ${right}> & ${right}`),
        '{}',
      );

  // `request` is the platform's `Request`, not a router's wrapper. Reading a form
  // is `await request.formData()` and nothing to look up. It is null while
  // prerendering, where there is no request to read.
  //
  // `action` is whatever the page's handler for this method returned, so a POST
  // and a GET render through the same loader.
  //
  // `response` is the part of the answer that is not markup. Change it, since the
  // object is shared with every loader in the chain and with the server, or return
  // a `Response` to answer the request yourself and skip rendering.
  //
  // `cookies` reads the request and writes into that same envelope. `__Cookies`
  // is defined by the shim, which is the only thing that reads this string.
  /**
   * What an endpoint's handler is handed. The same route context a loader gets,
   * without the two parts that only exist because a page renders: `layout` is
   * added by the chain walk, and `request` is never null because prerendering
   * never runs an endpoint.
   */
  const endpointLiteral = (params) =>
    `{ url: string; params: { ${params.map((name) => `${name}: string`).join('; ')} }; ` +
    `route: { id: string; pattern: string; path: string }; ` +
    `request: Request; fragment: string | null; ` +
    `response: { status: number; headers: Headers }; cookies: __Cookies; ` +
    `absolute: (path: string) => string; revalidateTag: (tag: string) => void }`;

  const contextLiteral = (params, layoutType) =>
    `{ url: string; params: { ${params.map((name) => `${name}: string`).join('; ')} }; ` +
    `route: { id: string; pattern: string; path: string }; ` +
    `layout: ${layoutType}; request: Request | null; fragment: string | null; ` +
    `action: unknown; response: { status: number; headers: Headers }; ` +
    `cookies: __Cookies; htmlAttrs: Record<string, string | boolean | null>; ` +
    `absolute: (path: string) => string; revalidateTag: (tag: string) => void }`;

  /**
   * Builds every shim in dependency order: components depend on nothing, a
   * layout on the layouts above it, a page on its whole chain. Each step asks
   * tsc what the previous one produced.
   */
  const build = () => {
    // Light and shadow elements take props the same way, so they are checked
    // the same way and their prop types reach whatever renders them.
    const componentProps = new Map();
    const componentMembers = new Map();
    const files = componentFiles();
    for (const file of files) {
      install(file, buildShim(sourceOf(file), { kind: 'component', shadow: isShadow(file) }));
    }
    for (const file of files) {
      const tag = path.basename(file, '.html');
      const blocks = splitBlocks(sourceOf(file));
      componentProps.set(tag, propTypeOf(file));
      // An element with neither block registers nothing, so it has no accessors
      // and no members. Saying otherwise in transclude-env.d.ts would be a claim
      // the browser does not back up.
      // Members live in the client block now, so the shim is what knows whether
      // there are any. An empty `__Members` means the block exported no
      // `prototype`, and having a client block at all is reason enough to upgrade.
      const members = memberTypeOf(file);
      componentMembers.set(tag, {
        members: members && members !== '{}' ? members : null,
        state: blocks.state ? stateTypeOf(file) : null,
        upgrades: Boolean(blocks.state || blocks.client.length),
      });
    }

    const layouts = layoutFiles();
    const layoutData = new Map();

    for (const [id, file] of [...layouts].sort((a, b) => depthOf(a[0]) - depthOf(b[0]))) {
      const above = mergeTypes(ancestorsOf(id, layouts).map((ancestor) => layoutData.get(ancestor)));
      install(
        file,
        buildShim(sourceOf(file), {
          kind: 'layout',
          contextType: contextLiteral([], above),
          componentProps,
        }),
      );
      layoutData.set(id, dataTypeOf(file));
    }

    const { routes, endpoints, notFound } = scanRoutes(resolveRoutesDir(app, routesDir));

    for (const route of endpoints) {
      install(route.file, buildEndpointShim(sourceOf(route.file), {
        contextType: endpointLiteral(route.params),
      }));
    }

    const pages = new Map();
    for (const route of [...routes, notFound].filter(Boolean)) {
      const above = mergeTypes(chainFor(route.rel, layouts).map((id) => layoutData.get(id)));
      const context = contextLiteral(route.params, above);
      install(
        route.file,
        buildShim(sourceOf(route.file), { kind: 'page', contextType: context, componentProps }),
      );
      pages.set(route.id, { route, context });
    }

    return { componentProps, componentMembers, layouts, layoutData, pages };
  };

  let project = build();

  const endpointFor = (file) => {
    const { endpoints } = scanRoutes(resolveRoutesDir(app, routesDir));
    return endpoints.find((route) => route.file === file) ?? null;
  };

  const contextFor = (file) => {
    if (path.basename(file) === LAYOUT_FILE) {
      const relative = path.relative(resolveRoutesDir(app, routesDir), path.dirname(file));
      const id = relative ? relative.split(path.sep).join('-') : 'root';
      return contextLiteral(
        [],
        mergeTypes(ancestorsOf(id, project.layouts).map((a) => project.layoutData.get(a))),
      );
    }
    for (const { route, context } of project.pages.values()) {
      if (route.file === file) return context;
    }
    return null;
  };

  const kindOf = (file) => {
    if (file.startsWith(path.resolve(app, elementsDir))) return 'component';
    return path.basename(file) === LAYOUT_FILE ? 'layout' : 'page';
  };

  const refresh = (file) => {
    if (file.endsWith('.js')) {
      const route = endpointFor(file);
      return install(file, buildEndpointShim(sourceOf(file), {
        contextType: endpointLiteral(route?.params ?? []),
      }));
    }
    const kind = kindOf(file);
    return install(
      file,
      buildShim(sourceOf(file), {
        kind,
        shadow: isShadow(file),
        contextType: kind === 'component' ? null : contextFor(file),
        componentProps: project.componentProps,
      }),
    );
  };

  return {
    files() {
      const found = componentFiles();
      const dir = resolveRoutesDir(app, routesDir);
      walkHtml(dir, found);
      for (const route of scanRoutes(dir).endpoints) found.push(route.file);
      return found;
    },

    /** Replaces a file's contents without touching disk, for an editor buffer. */
    update(file, source) {
      overlays.set(file, source);
      refresh(file);
    },

    /** Re-derives every type. Needed after a file is added, renamed or removed. */
    rebuild() {
      project = build();
    },

    check(file) {
      const shim = refresh(file);
      const name = shimPath(file);

      // A file that does not parse gets one diagnostic, not a cascade of type
      // errors derived from the half of it that survived.
      if (shim.syntaxErrors?.length) {
        return shim.syntaxErrors.map((error) => ({
          file,
          offset: error.offset,
          length: 1,
          code: 1005,
          message: error.message,
          severity: 'error',
        }));
      }

      const out = [];
      for (const diagnostic of [
        ...service.getSyntacticDiagnostics(name),
        ...service.getSemanticDiagnostics(name),
      ]) {
        const offset = originalOffset(shim.chunks, diagnostic.start ?? 0);
        // A diagnostic with no home is one about generated scaffolding. Dropping
        // it is right, but it means anything that can carry a diagnostic has to be
        // mapped, or it disappears without a word.
        if (offset === null) continue;

        out.push({
          file,
          offset,
          length: diagnostic.length ?? 1,
          code: diagnostic.code,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
          severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        });
      }
      return out.sort((a, b) => a.offset - b.offset);
    },

    /** Type of the expression at a source offset, for editor hovers. */
    quickInfo(file, offset) {
      const shim = shims.get(shimPath(file)) ?? refresh(file);
      const target = shim.chunks.find(
        (chunk) =>
          chunk.source !== null &&
          offset >= chunk.source &&
          offset < chunk.source + chunk.text.length,
      );
      if (!target) return null;

      const info = service.getQuickInfoAtPosition(
        shimPath(file),
        target.start + (offset - target.source),
      );
      if (!info) return null;

      return {
        text: ts.displayPartsToString(info.displayParts),
        documentation: ts.displayPartsToString(info.documentation ?? []),
      };
    },

    /**
     * Everything transclude-env.d.ts is written from.
     *
     * Every type string is passed through `named`, which turns a qualified
     * reference into a bare name and collects what that name is. A type the app
     * declared is reachable from the file it was written in and from nowhere
     * else, so the emitted file carries its own copy rather than an import: one
     * declared in an .html file has no module to be imported from at all.
     */
    describe() {
      const aliases = { byKey: new Map(), text: new Map() };
      const named = (type) => resolveNames(type, aliases);
      // Light elements are described separately: they have props but no shadow
      // root, so nothing about `this.shadowRoot` applies to them.
      const partialTags = new Set(
        componentFiles()
          .filter((file) => !isShadow(file))
          .map((file) => path.basename(file, '.html')),
      );
      const element = ([tag, type]) => {
        const { members, state, upgrades } = project.componentMembers.get(tag) ?? {};
        return {
          tag,
          type: named(type),
          upgrades,
          members: members ? named(members) : members,
          state: state ? named(state) : state,
        };
      };

      const described = {
        components: [...project.componentProps]
          .filter(([tag]) => !partialTags.has(tag))
          .map(element),
        partials: [...project.componentProps].filter(([tag]) => partialTags.has(tag)).map(element),
        layouts: [...project.layoutData].map(([id, type]) => ({
          id,
          type: named(type),
          context: named(contextFor(project.layouts.get(id))),
        })),
        pages: [...project.pages].map(([id, { route, context }]) => ({
          id,
          params: route.params,
          pattern: route.pattern,
          context: named(context),
          type: named(dataTypeOf(route.file)),
        })),
      };

      // Collected while the above was named, so it is read after, not during.
      return { ...described, types: [...aliases.text].map(([name, type]) => ({ name, type })) };
    },
  };
}

/**
 * Line and column for an offset, for anything that reports to a human.
 *
 * @param {string} source
 * @param {number} offset
 * @returns {{ line: number, column: number }} both 1-based, for a message a reader can follow
 */
export function positionAt(source, offset) {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - (before.lastIndexOf('\n') + 1);
  return { line, column };
}

function depthOf(layoutId) {
  return layoutId === 'root' ? 0 : layoutId.split('-').length;
}

function readDirSafe(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function walkHtml(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}
