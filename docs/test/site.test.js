// The site's own checks. They read the built output, so `npm run build` has to
// have run first.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `url.pathname`: a space in the project path stays
// percent-encoded in the second one.
const root = path.dirname(fileURLToPath(import.meta.url));
const routes = path.join(root, '..', 'app', 'routes');

/** Every page the nav claims to link to. */
function navLinks() {
  const layout = fs.readFileSync(path.join(routes, '_layout.html'), 'utf8');
  return [...layout.matchAll(/href:\s*'([^']+)'/g)].map(([, href]) => href);
}

test('every nav link has a page behind it', () => {
  const missing = navLinks().filter((href) => {
    const name = href === '/' ? 'index' : href.slice(1);
    return !fs.existsSync(path.join(routes, `${name}.html`));
  });

  assert.deepEqual(missing, [], `nav links with no page: ${missing.join(', ')}`);
});

test('every page has a title and a description', () => {
  const without = [];

  for (const name of fs.readdirSync(routes)) {
    if (!name.endsWith('.html') || name.startsWith('_')) continue;
    const source = fs.readFileSync(path.join(routes, name), 'utf8');

    if (!/<title>/.test(source)) without.push(`${name}: no <title>`);
    // The error pages are reached for rather than linked to, so they need no
    // description.
    if (!/name="description"/.test(source) && !/^(404|500)\.html$/.test(name)) {
      without.push(`${name}: no description`);
    }
  }

  assert.deepEqual(without, []);
});

test('the fonts the stylesheet names are the fonts that exist', () => {
  const css = fs.readFileSync(path.join(root, '..', 'app', 'styles', 'global.css'), 'utf8');
  const named = [...css.matchAll(/url\("?\/fonts\/([^")]+)"?\)/g)].map(([, file]) => file);
  assert.notEqual(named.length, 0, 'the stylesheet should name some fonts');

  const dir = path.join(root, '..', 'app', 'public', 'fonts');
  const missing = named.filter((file) => !fs.existsSync(path.join(dir, file)));

  assert.deepEqual(missing, [], `named but not present: ${missing.join(', ')}`);
});
