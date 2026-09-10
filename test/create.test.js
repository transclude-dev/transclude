// Starting a project.
//
// `@transclude/create` is its own package: scaffolding five files should not
// download a compiler. Its tests live here because `npm test` runs here, and
// because the templates they check have to keep building against this checkout.
//
// These run the bin the way a person does and read what lands. What is in
// `templates/` is what a new project is, so the assertions are about the files
// rather than about the code that copies them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const create = path.join(root, 'create', 'index.js');

/** Runs the bin into a fresh directory and hands back that directory. */
const make = (args, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-create-'));
  const target = path.join(dir, 'app-name');
  try {
    execFileSync('node', [create, target, ...args, '--yes'], { encoding: 'utf8' });
    return fn(target);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('the blank template is one page and the files to serve it', () => {
  make(['--template', 'blank'], (dir) => {
    const files = fs.readdirSync(path.join(dir, 'app', 'routes'));
    assert.deepEqual(files, ['index.html']);

    const page = read(dir, 'app/routes/index.html');
    assert.match(page, /<h1>/);
    assert.doesNotMatch(page, /<script server>/, 'the blank page has a loader');
  });
});

test('the minimal template has a layout, a second page and a 404', () => {
  make(['--template', 'minimal'], (dir) => {
    const files = fs.readdirSync(path.join(dir, 'app', 'routes')).sort();
    assert.deepEqual(files, ['404.html', '_layout.html', 'about.html', 'index.html']);
  });
});

test('both templates say which color schemes they handle, before the CSS lands', () => {
  // The stylesheet says it too, and the stylesheet is a second request. The tag
  // is parsed before that request finishes, which is the window it exists for.
  //
  // On `:root` in the CSS and not on `body`: the canvas and the scrollbars take
  // their scheme from the root element, so `body` dresses the controls and
  // leaves the page behind them light.
  for (const [template, page] of [
    ['blank', 'app/routes/index.html'],
    ['minimal', 'app/routes/_layout.html'],
  ]) {
    make(['--template', template], (dir) => {
      assert.match(read(dir, page), /<meta name="color-scheme" content="light dark"/);

      const css = read(dir, 'app/styles/global.css');
      assert.match(css, /:root\s*\{[^}]*color-scheme:\s*light dark/);
      assert.doesNotMatch(css, /body\s*\{[^}]*color-scheme/, 'color-scheme on body');
    });
  }
});

test('both templates ship the two headers a new project should not have to find', () => {
  // `csp` and `permissionsPolicy` are off in `DEFAULTS`, because each takes away
  // something an app may want and that stays the author's call. A generated
  // project is where that call can be made for them and still be read. The key
  // sits in a file they own, beside the sentence saying what to do when a page
  // wants a camera.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      const config = read(dir, 'transclude.config.js');

      assert.match(config, /^\s*csp: true,/m, `${template} starts with no policy`);
      assert.match(config, /^\s*permissionsPolicy: true,/m, `${template} refuses nothing`);
    });
  }
});

test('both templates say what language they are written in', () => {
  // `lang` defaults to 'en' for every app in the world, which is a guess the
  // framework makes quietly. Writing it into the generated config is how the
  // guess becomes a line the author can see and change.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      assert.match(read(dir, 'transclude.config.js'), /^\s*lang: 'en',/m, template);
    });
  }
});

test('the minimal layout opens with a skip link, and something to skip to', () => {
  // First in the DOM so a keyboard reaches it before the nav, offscreen until
  // focused, and pointing at an id that exists. `position: absolute` rather than
  // `display: none`, because nothing hidden that way can be focused at all.
  make(['--template', 'minimal'], (dir) => {
    const layout = read(dir, 'app/routes/_layout.html');
    assert.match(layout, /<a class="skip" href="#main">/);
    assert.match(layout, /<main id="main">/);
    assert.ok(
      layout.indexOf('class="skip"') < layout.indexOf('<nav>'),
      'the skip link comes after the nav it exists to skip',
    );

    const css = read(dir, 'app/styles/global.css');
    assert.match(css, /\.skip\s*\{[^}]*position:\s*absolute/);
    assert.match(css, /\.skip:focus/);
    assert.doesNotMatch(css, /\.skip\s*\{[^}]*display:\s*none/);
  });
});

test('neither template ships the demo of things a starter should not decide', () => {
  // Fragments and includes are what the showcase is for. A project starts
  // without an opinion about them, and without an opinion about its own markup:
  // `svg-icon` ships as a file, and no page here uses it.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      const all = fs
        .readdirSync(path.join(dir, 'app', 'routes'))
        .map((name) => read(dir, `app/routes/${name}`))
        .join('\n');

      assert.doesNotMatch(all, /<transclude/, `${template} includes something`);
      assert.doesNotMatch(all, /\bfragment\b/, `${template} declares a region`);
      assert.doesNotMatch(all, /<svg-icon/, `${template} decides where an icon goes`);
    });
  }
});

test('both templates ship the icon element, and it is the only one', () => {
  // The framework ships no elements. This one is scaffolded instead, so it is
  // the project's file to edit rather than an API to keep compatible, and
  // nobody hand-writes the two aria spellings from memory.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      const files = fs.readdirSync(path.join(dir, 'app', 'elements'));
      assert.deepEqual(files, ['svg-icon.html'], `${template} has other elements`);

      const source = read(dir, 'app/elements/svg-icon.html');

      // The trap it exists to close, tested as the trap rather than as a
      // spelling: an icon that is hidden and labeled at once announces
      // nothing, and an icon that is neither announces its file name.
      const labeled = source.match(/<svg if="label"[^>]*>/)?.[0] ?? '';
      const decorative = source.match(/<svg else[^>]*>/)?.[0] ?? '';

      assert.match(labeled, /aria-label/, `${template}: the labeled icon has no label`);
      assert.doesNotMatch(labeled, /aria-hidden/, `${template}: a labeled icon is also hidden`);
      assert.match(decorative, /aria-hidden="true"/, `${template}: the plain icon is announced`);
      assert.doesNotMatch(decorative, /aria-label/, `${template}: a hidden icon carries a label`);

      assert.match(source, /href="\/\$\{library\}\.svg#\$\{name\}"/);
    });
  }
});

test('a leading underscore in a template becomes a dot', () => {
  // Both of these would be read as belonging to the templates themselves if
  // they were written with their real names: git and npm act on a `.gitignore`
  // wherever they find one, and editor tooling treats a `.vscode` as a project.
  make(['--template', 'minimal'], (dir) => {
    assert.ok(fs.existsSync(path.join(dir, '.gitignore')), 'no .gitignore');
    assert.ok(fs.existsSync(path.join(dir, '.vscode/settings.json')), 'no .vscode/settings.json');
    assert.ok(!fs.existsSync(path.join(dir, '_vscode')), 'the template name was copied through');
  });
});

test('both templates turn off the HTML validation that misreads an element', () => {
  // A `.html` file here holds several script blocks that are separate modules.
  // The built-in HTML support reads them as one, so a page's `<script server>`
  // and its client `<script>` are reported as one module with two sets of
  // top-level names. The file is correct, and `npm run check` says so.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      const settings = read(dir, '.vscode/settings.json');
      assert.match(settings, /"html\.validate\.scripts":\s*false/, `${template}`);
    });
  }
});

test('the directory name becomes the package name and the heading', () => {
  make(['--template', 'blank'], (dir) => {
    assert.equal(JSON.parse(read(dir, 'package.json')).name, 'app-name');
    assert.match(read(dir, 'app/routes/index.html'), /<h1>app-name<\/h1>/);
    assert.doesNotMatch(read(dir, 'package.json'), /__NAME__|__TRANSCLUDE__/);
  });
});

test('it depends on a published version, not on wherever this checkout is', () => {
  // What this is really guarding is that `--link` did not leak into a scaffold
  // nobody asked to link. A prerelease suffix is allowed: scaffolding from
  // `@transclude/create@next` has to write the version that exists, and
  // `^1.0.0` names one the registry does not serve yet.
  make(['--template', 'blank'], (dir) => {
    const { dependencies } = JSON.parse(read(dir, 'package.json'));
    assert.match(dependencies['@transclude/core'], /^\^\d+\.\d+\.\d+(-[\w.]+)?$/);
    assert.doesNotMatch(dependencies['@transclude/core'], /^file:/);
  });
});

test('--link points at the checkout instead, which is how the framework is worked on', () => {
  make(['--template', 'blank', '--link'], (dir) => {
    const { dependencies } = JSON.parse(read(dir, 'package.json'));
    assert.equal(dependencies['@transclude/core'], `file:${root}`);
  });
});

test('the ignore file arrives named so tools read it', () => {
  // `.gitignore` inside `templates/` would be applied to the template itself by
  // everything that reads one, npm included, so it is stored as `_gitignore`.
  make(['--template', 'blank'], (dir) => {
    assert.ok(fs.existsSync(path.join(dir, '.gitignore')));
    assert.ok(!fs.existsSync(path.join(dir, '_gitignore')));
    assert.match(read(dir, '.gitignore'), /node_modules/);
  });
});

test('a directory with something in it is refused rather than merged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-create-'));
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'do not lose me');

  try {
    assert.throws(
      () => execFileSync('node', [create, dir, '--yes'], { encoding: 'utf8', stdio: 'pipe' }),
      /is not empty/,
    );
    assert.equal(fs.readFileSync(path.join(dir, 'mine.txt'), 'utf8'), 'do not lose me');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('both templates can reach the fourth runtime', () => {
  // "The same app runs on Node, Bun, Deno and workerd" is the second sentence
  // of the README, and a scaffolded project was Node-only: reaching the fourth
  // meant finding the runtimes page and writing two files by hand. Eleven
  // examples had them to copy and a new project had neither.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      const worker = read(dir, 'worker.js');
      assert.match(worker, /workerFrom/, `${template}: worker.js does not use the adapter`);

      const wrangler = read(dir, 'wrangler.jsonc');
      assert.match(wrangler, /"name": "app-name"/, `${template}: the name was not substituted`);
      // Left in, this is the date the template was written rather than the date
      // the project was, and it decides which runtime behaviors the worker gets.
      assert.doesNotMatch(wrangler, /__[A-Z]+__/, `${template}: a placeholder is still in`);
      assert.match(
        wrangler,
        /"compatibility_date": "\d{4}-\d{2}-\d{2}"/,
        `${template}: no compatibility date`,
      );

      const scripts = JSON.parse(read(dir, 'package.json')).scripts;
      assert.equal(scripts.deploy, 'npm run build && npx wrangler deploy');
      // npx, because wrangler is not a dependency here. A bare `wrangler` in a
      // script does not fall back to it and fails with a command not found.
      assert.match(scripts['start:worker'], /^npx wrangler/);
    });
  }
});

test('a template nobody has says so, and names the ones there are', () => {
  assert.throws(
    () => execFileSync('node', [create, 'x', '-t', 'nope', '--yes'], { stdio: 'pipe' }),
    /no template called "nope".*minimal, blank/s,
  );
});

test('every template builds a project that type-checks', () => {
  // The templates carry `__NAME__` in places tsc reads, so a placeholder left in
  // the wrong file is a syntax error nobody would see until a person ran it.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      for (const rel of ['package.json', 'jsconfig.json']) {
        assert.doesNotThrow(() => JSON.parse(read(dir, rel)), `${template}/${rel}`);
      }
      assert.doesNotMatch(read(dir, 'transclude.config.js'), /__[A-Z]+__/);
    });
  }
});
