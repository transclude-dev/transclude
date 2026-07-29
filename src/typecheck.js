// Type checking and type extraction, both by TypeScript.
//
// Shims live in memory at `<file>.html.js`, never on disk. Naming them after the
// source file is what makes their relative imports resolve the way the author
// wrote them — a shim in a mirror directory would have to rewrite every
// specifier, and rewriting is where source mapping goes to die.
//
// JavaScript rather than TypeScript because a JSDoc `@type` in the author's own
// `<script props>` is honoured in a .js file and silently ignored in a .ts one.
//
// Shims are self-contained: route contexts and component props are inlined as
// type literals rather than imported. hf-env.d.ts is written *from* the shims,
// so it cannot also be an input to them.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { buildShim, originalOffset } from './compiler/shim.js';
import { splitBlocks } from './compiler/index.js';
import { scanRoutes } from './routes.js';

/**
 * Annotations are optional, so `noImplicitAny` is off: an unannotated parameter
 * is `any` rather than an error, and the author writes plain modern JavaScript.
 * What that would normally cost — undeclared property reads being allowed on a
 * type that came from an object literal — the shim buys back by remapping the
 * keys, so `${user.nmae}` is still an error.
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

const TYPE_FORMAT =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.InTypeAlias |
  ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;

const LAYOUT_FILE = '_layout.html';

export function createChecker({
  root,
  appDir = 'app',
  componentsDir = 'components',
  partialsDir = 'partials',
  pagesDir = 'pages',
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

  /** The type of one of a shim's marker exports — what tsc made of the file. */
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

  const dataTypeOf = (file) => exportTypeOf(file, '__data');
  const propTypeOf = (file) => exportTypeOf(file, '__propTypes');
  const memberTypeOf = (file) => exportTypeOf(file, '__members');
  const stateTypeOf = (file) => exportTypeOf(file, '__state');

  // ---- the project, in the only order that resolves ------------------------

  const elementFiles = (dir) =>
    readDirSafe(path.resolve(app, dir))
      .filter((entry) => entry.endsWith('.html') && entry.slice(0, -5).includes('-'))
      .map((entry) => path.resolve(app, dir, entry));

  const componentFiles = () => elementFiles(componentsDir);
  const partialFiles = () => elementFiles(partialsDir);

  // The directory decides whether the element has a shadow root, so it also
  // decides what `this.shadowRoot` means inside <script element>.
  const isShadow = (file) => file.startsWith(path.resolve(app, componentsDir));

  const layoutFiles = (dir = path.resolve(app, pagesDir), out = new Map()) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) layoutFiles(full, out);
      else if (entry.name === LAYOUT_FILE) {
        const relative = path.relative(path.resolve(app, pagesDir), dir);
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

  // `request` is the platform's `Request`, not a router's wrapper — reading a
  // form is `await request.formData()` and nothing to look up. It is null while
  // prerendering, where there is no request to read.
  //
  // `action` is whatever the page's handler for this method returned, so a POST
  // and a GET render through the same loader.
  //
  // `response` is the part of the answer that is not markup. Mutate it — the
  // object is shared with every loader in the chain and with the server — or
  // return a `Response` to answer for yourself and skip rendering.
  const contextLiteral = (params, layoutType) =>
    `{ url: string; params: { ${params.map((name) => `${name}: string`).join('; ')} }; ` +
    `route: { id: string; pattern: string; path: string }; ` +
    `layout: ${layoutType}; request: Request | null; fragment: string | null; ` +
    `action: unknown; response: { status: number; headers: Headers } }`;

  /**
   * Builds every shim in dependency order: components depend on nothing, a
   * layout on the layouts above it, a page on its whole chain. Each step asks
   * tsc what the previous one produced.
   */
  const build = () => {
    // Partials take props exactly like components, so they are checked the same
    // way and their prop types are available to whatever renders them.
    const componentProps = new Map();
    const componentMembers = new Map();
    const files = [...componentFiles(), ...partialFiles()];
    for (const file of files) {
      install(file, buildShim(sourceOf(file), { kind: 'component', shadow: isShadow(file) }));
    }
    for (const file of files) {
      const tag = path.basename(file, '.html');
      const blocks = splitBlocks(sourceOf(file));
      componentProps.set(tag, propTypeOf(file));
      // A partial with neither block registers no custom element, so it has no
      // accessors and no members — saying otherwise in hf-env.d.ts would be a
      // lie the browser does not back up.
      // Members live in the client block now, so the shim is what knows whether
      // there are any — an empty `__Members` means the block exported no
      // `prototype`, and a client block at all is reason enough to upgrade.
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

    const { routes, notFound } = scanRoutes(path.resolve(app, pagesDir));
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

  const contextFor = (file) => {
    if (path.basename(file) === LAYOUT_FILE) {
      const relative = path.relative(path.resolve(app, pagesDir), path.dirname(file));
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
    if (file.startsWith(path.resolve(app, componentsDir))) return 'component';
    if (file.startsWith(path.resolve(app, partialsDir))) return 'component';
    return path.basename(file) === LAYOUT_FILE ? 'layout' : 'page';
  };

  const refresh = (file) => {
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
      const found = [...componentFiles(), ...partialFiles()];
      walkHtml(path.resolve(app, pagesDir), found);
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
        // it is right — but it means anything that can carry a diagnostic has to
        // be mapped, or it disappears silently.
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

    /** Everything hf-env.d.ts is written from. */
    describe() {
      const partialTags = new Set(partialFiles().map((file) => path.basename(file, '.html')));
      return {
        components: [...project.componentProps]
          .filter(([tag]) => !partialTags.has(tag))
          .map(([tag, type]) => ({ tag, type, ...project.componentMembers.get(tag) })),
        partials: [...project.componentProps]
          .filter(([tag]) => partialTags.has(tag))
          .map(([tag, type]) => ({ tag, type, ...project.componentMembers.get(tag) })),
        layouts: [...project.layoutData].map(([id, type]) => ({
          id,
          type,
          context: contextFor(project.layouts.get(id)),
        })),
        pages: [...project.pages].map(([id, { route, context }]) => ({
          id,
          params: route.params,
          pattern: route.pattern,
          context,
          type: dataTypeOf(route.file),
        })),
      };
    },
  };
}

/** Line and column for an offset, for anything that reports to a human. */
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
