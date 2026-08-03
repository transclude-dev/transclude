#!/usr/bin/env node
// Starts a project. `npm create transclude my-app`, or `npx create-transclude`.
//
// It copies a template and rewrites three things: the package name, the
// dependency on this framework, and the title on the page. Nothing else is
// generated, so what lands is what is in `templates/`, and reading that
// directory tells you exactly what a new project is.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, never `url.pathname`: a space in the path stays
// percent-encoded in the second one, and `Atelier%20Dakroub` is not a directory.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const templates = path.join(root, 'templates');

const TEMPLATES = [
  { name: 'minimal', what: 'a layout, two pages, a 404 and a stylesheet' },
  { name: 'blank', what: 'one page, and nothing else' },
];

/** npm refuses some of what a directory name allows, and so does this. */
const NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function usage() {
  const list = TEMPLATES.map((t) => `    ${t.name.padEnd(9)} ${t.what}`).join('\n');
  return [
    'Usage: create-transclude [directory] [options]',
    '',
    '  --template <name>  which files to start from',
    `${list}`,
    '  --yes              take the defaults and ask nothing',
    '  --link             depend on a local checkout, for working on the framework',
    '',
  ].join('\n');
}

/** Arguments, in the shape the rest of the file wants them. */
function parse(argv) {
  const options = { dir: null, template: null, yes: false, link: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--link') options.link = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--template' || arg === '-t') options.template = argv[++i];
    else if (arg.startsWith('--template=')) options.template = arg.slice('--template='.length);
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else if (options.dir === null) options.dir = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  return options;
}

/**
 * Every file under `dir`, relative to it.
 *
 * `node_modules` and `dist` are skipped so running this from a directory that
 * was used once does not copy a build into a new project.
 */
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

/**
 * What a directory can be written into.
 *
 * An existing directory is fine when it holds nothing that would be
 * overwritten; a `.git` from `git init` is the ordinary case. Anything else is
 * refused rather than merged, because a half-copied project is worse to
 * untangle than one that never started.
 */
function checkTarget(dir) {
  if (!fs.existsSync(dir)) return;
  const held = fs.readdirSync(dir).filter((name) => name !== '.git' && name !== '.DS_Store');
  if (held.length) {
    throw new Error(`${path.relative(process.cwd(), dir) || '.'} is not empty`);
  }
}

/** The dependency a new project declares on this framework. */
function dependency(link) {
  if (link) return `file:${root}`;
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return `^${version}`;
}

async function ask(options) {
  // A pipe is not a person. Without a terminal the defaults are the only answers
  // available, and hanging on a prompt nobody can see is the worse failure.
  if (options.yes || !process.stdin.isTTY) {
    return { dir: options.dir ?? 'my-app', template: options.template ?? TEMPLATES[0].name };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let dir = options.dir;
    while (!dir) dir = (await rl.question('Directory (my-app): ')).trim() || 'my-app';

    let template = options.template;
    if (!template) {
      const names = TEMPLATES.map((t) => t.name).join(', ');
      const answer = (await rl.question(`Template (${names}) [minimal]: `)).trim();
      template = answer || TEMPLATES[0].name;
    }
    return { dir, template };
  } finally {
    rl.close();
  }
}

/**
 * Copies one template, substituting the two placeholders.
 *
 * Only `.json`, `.js`, `.html`, `.css` and `.md` are read as text. Anything else
 * is copied byte for byte, so a template may hold an image without this
 * corrupting it.
 */
function copy(from, to, replacements) {
  const TEXT = new Set(['.json', '.js', '.html', '.css', '.md', '.txt']);

  for (const rel of walk(from)) {
    // `.gitignore` in a template would be applied to the template itself by
    // every tool that reads one, including npm when this is packed.
    const target = path.join(to, rel === '_gitignore' ? '.gitignore' : rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (!TEXT.has(path.extname(rel))) {
      fs.copyFileSync(path.join(from, rel), target);
      continue;
    }

    let text = fs.readFileSync(path.join(from, rel), 'utf8');
    for (const [token, value] of Object.entries(replacements)) {
      text = text.split(token).join(value);
    }
    fs.writeFileSync(target, text);
  }
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const answers = await ask(options);
  const template = TEMPLATES.find((t) => t.name === answers.template);
  if (!template) {
    const names = TEMPLATES.map((t) => t.name).join(', ');
    throw new Error(`no template called ${JSON.stringify(answers.template)}. There is ${names}.`);
  }

  const target = path.resolve(process.cwd(), answers.dir);
  checkTarget(target);

  const name = path.basename(target);
  if (!NAME.test(name)) {
    throw new Error(`${JSON.stringify(name)} is not a usable package name`);
  }

  copy(path.join(templates, template.name), target, {
    __NAME__: name,
    __TRANSCLUDE__: dependency(options.link),
  });

  const where = path.relative(process.cwd(), target);
  process.stdout.write(
    [
      `\nCreated ${name} from the ${template.name} template.\n\n`,
      where ? `  cd ${where}\n` : '',
      '  npm install\n',
      '  npm run dev\n\n',
    ].join(''),
  );
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n\n${usage()}`);
  process.exitCode = 1;
});
