#!/usr/bin/env node
// Prepares a release. It does not publish: it sets the version in both packages,
// runs everything, and writes a tag. Pushing that tag is what publishes, and
// that happens in CI where the token lives and provenance can be signed.
//
// Both packages move together and share a version. They are one project split
// for a packaging reason, and a new project's dependency on `@transclude/core`
// is written by `@transclude/create` from its own version, so two numbers that
// drift would write a dependency that does not exist.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFESTS = ['package.json', 'create/package.json'];

const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...options });

const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

function usage() {
  return [
    'Usage: node bin/release.js <version|major|minor|patch> [--dry-run]',
    '',
    '  Sets the version in both packages, verifies, commits and tags.',
    '  Pushing the tag is what publishes. Nothing here talks to a registry.',
    '',
  ].join('\n');
}

/** `1.2.3`, or what `major`/`minor`/`patch` makes of the current one. */
function nextVersion(current, asked) {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(asked)) return asked;

  const [major, minor, patch] = current.split('.').map(Number);
  if (asked === 'major') return `${major + 1}.0.0`;
  if (asked === 'minor') return `${major}.${minor + 1}.0`;
  if (asked === 'patch') return `${major}.${minor}.${patch + 1}`;

  throw new Error(`${JSON.stringify(asked)} is not a version or major/minor/patch`);
}

/**
 * Refuses to release from a tree that is not exactly what was tested.
 *
 * A dirty tree means the tag would name a commit that does not hold what was
 * verified, and the tarball CI builds comes from the tag rather than from here.
 */
function assertReleasable() {
  if (run('git', ['status', '--porcelain']).trim()) {
    throw new Error('the working tree has changes. Commit or stash them first.');
  }

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') throw new Error(`on ${branch}, and a release is cut from main`);

  return read('package.json').version;
}

/**
 * Refuses a version that already has a tag.
 *
 * Re-tagging is how two different tarballs come to claim one version: the
 * registry keeps the first and the tag names the second, and nothing afterwards
 * says which one anybody installed.
 */
function assertUntagged(version) {
  const tags = run('git', ['tag', '--list']).split('\n').map((t) => t.trim());
  if (tags.includes(`v${version}`)) {
    throw new Error(`v${version} is already tagged. Releasing it again would move the tag.`);
  }
}

function setVersion(version) {
  for (const rel of MANIFESTS) {
    const file = path.join(root, rel);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.version = version;
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

/** Everything, in the order that fails cheapest first. */
function verify() {
  const steps = [
    // `check:src` is not here. It exits non-zero on any diagnostic, and most of
    // what it reports is a pattern TypeScript cannot model rather than a defect.
    // The part that is a gate is a test, and `npm test` runs it.
    ['the framework', 'npm', ['test']],
    ['the demo', 'npm', ['run', 'test:examples']],
    ['the docs', 'npm', ['test', '--prefix', 'www']],
    ['the docs types', 'npm', ['run', 'check', '--prefix', 'www']],
    ['the docs build', 'npm', ['run', 'build', '--prefix', 'www']],
  ];

  for (const [what, command, args] of steps) {
    process.stdout.write(`  ${what} … `);
    try {
      run(command, args);
      process.stdout.write('ok\n');
    } catch (error) {
      process.stdout.write('failed\n\n');
      throw new Error(`${what} failed:\n\n${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
  }
}

/** What each package would ship, so a missing `files` entry is seen before a tag. */
function packed() {
  for (const dir of [root, path.join(root, 'create')]) {
    const listing = run('npm', ['pack', '--dry-run', '--json'], { cwd: dir });
    const [{ name, files }] = JSON.parse(listing);
    process.stdout.write(`  ${name}: ${files.length} files\n`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const asked = args.find((a) => !a.startsWith('-'));

  if (!asked || args.includes('--help')) {
    process.stdout.write(usage());
    return;
  }

  const current = assertReleasable();
  const version = nextVersion(current, asked);
  assertUntagged(version);
  process.stdout.write(`\n${current} -> ${version}\n\n`);

  setVersion(version);

  try {
    verify();
    packed();
  } catch (error) {
    // Put the versions back. A failed release should leave nothing behind.
    setVersion(current);
    throw error;
  }

  if (dryRun) {
    setVersion(current);
    process.stdout.write('\nDry run. Versions put back, nothing committed.\n\n');
    return;
  }

  run('git', ['add', ...MANIFESTS]);

  // A first release at the version the manifests already carry changes nothing,
  // and an empty commit is not worth making. The tag is the release either way.
  const staged = run('git', ['diff', '--cached', '--name-only']).trim();
  if (staged) run('git', ['commit', '-m', `Release ${version}`]);

  run('git', ['tag', '-a', `v${version}`, '-m', `Release ${version}`]);

  process.stdout.write(
    [
      `\nTagged v${version}. Nothing has been published yet.\n\n`,
      '  git push --follow-tags\n\n',
      'That is what publishes. The workflow builds from the tag and signs\n',
      'provenance against it.\n\n',
    ].join(''),
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`\n${error.message}\n`);
  process.exitCode = 1;
}
