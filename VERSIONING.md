# Versioning

What a version number here promises, and what it does not.

This file is the policy. `docs/decisions.html` on the site points at it rather
than restating it, because a promise kept in two places is a promise that will
be made twice and differently.

## What each number means

**A patch fixes something.** Nothing is added and nothing is refused that was
not refused before.

**A minor may add a refusal.** That is the shape a break takes here, and it is
the only shape one takes without a major. A refusal rejects code that was
already not doing what it looked like it did, so a page that passes a new
refusal was already wrong; what changes is that it now says so. Every release
that adds one names it at the top of its notes, with the change to make.

A minor may also add a config key, a field on the loader context, or a subpath
to `exports`. Adding is not breaking.

**A major renames or removes.** Nothing else does.

## Where the notes are

A release's notes are the message on its git tag, published to
[the releases page](https://github.com/transclude-dev/transclude/releases).
There is no `CHANGELOG.md`. The tag carries the message already, and a file that
repeats it is the copy that goes stale.

A release that adds a refusal names it in the first lines, with the change to
make. Those lines are the only place that promise is kept, so they are what to
read before an upgrade.

## What is covered

Four tables, and each is pinned to the code by a test, so the promise cannot
drift from what ships:

| | |
| --- | --- |
| the config keys | `test/defaults.test.js` |
| the loader context | `test/context-shape.test.js` |
| the `exports` subpaths | `test/package.test.js` |
| the names an app may import | `test/package.test.js` |

A name in any of them is a promise. It does not change without a major.

The last two are separate on purpose. A subpath is a path, and a path that
resolves says nothing about what is behind it: ten of the twelve export eighty
names between them, and most exist so the framework can talk to itself. Reading
the two as one promise would cover far more than is meant.

**`PROMISED`** in `test/package.test.js` is what an app may import — the Vite
plugin, `createApp`, `cookiesOf`, `renderRoute`, `renderFragment`, `responseOf`,
the four `production` exports and `workerFrom`. Each is a name, and a name does
not move without a major.

**`WIRING`** is the rest: `./compiler`, `./routes`, `./runtime`, `./typecheck`
and the two `serve.*` adapters. The path stays, and removing one is still a
major. The names behind it move between minors. `./runtime` is the clearest
case, because those names are what the compiler emits calls to: they are an
output format rather than an API, and an app that imports one has reached past
the seam.

## What is not covered

**Anything under `src/` that `exports` does not name.** The subpaths in
`package.json` are the API. A deep import into a file reaches code that moves
between minors, and nothing will warn you.

**A name behind a `WIRING` subpath, and a name a promised subpath exports that
`PROMISED` leaves out.** Both resolve, both work, and both move. `import
{ withEnvelope } from '@transclude/core/document'` is the shape to watch for:
the subpath is promised and that name is not.

**What a refusal says.** The list of refusals is at `/docs/refusals` and it
grows. The wording of a message, its line number, and the file that raises it
are not promises.

**The shape of the build output.** `dist/` is a build, reproducible from source.
Read `routes.json` if you must, and expect it to move.

## Prereleases

A version with a suffix — `1.0.0-rc.1` — is staged to npm's `next` tag, never to
`latest`. `npm install @transclude/core` keeps giving you the last real release.
To ask for a candidate, ask for it:

```sh
npm install @transclude/core@next
```

## Before 1.0

Below `1.0` a minor may break something, and two releases have. Both were
narrow, and both were the compiler starting to refuse code that was already not
doing what it looked like it did — the same shape a minor is allowed after
`1.0`.

Nothing has renamed or removed a documented field or key. There has not been a
major, and the intent is that `1.0` is the first one that could be.
