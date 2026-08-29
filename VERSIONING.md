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

## What is covered

Three tables, and each is pinned to the code by a test, so the promise cannot
drift from what ships:

| | |
| --- | --- |
| the config keys | `test/defaults.test.js` |
| the loader context | `test/context-shape.test.js` |
| the `exports` subpaths | `test/package.test.js` |

A name in any of them is a promise. It does not change without a major.

## What is not covered

**Anything under `src/` that `exports` does not name.** The subpaths in
`package.json` are the API. A deep import into a file reaches code that moves
between minors, and nothing will warn you.

**What a refusal says.** The list of refusals is at `/docs/refusals` and it
grows. The wording of a message, its line number, and the file that raises it
are not promises.

**The shape of the build output.** `dist/` is a build, reproducible from source.
Read `routes.json` if you must, and expect it to move.

## Before 1.0

Below `1.0` a minor may break something, and two releases have. Both were
narrow, and both were the compiler starting to refuse code that was already not
doing what it looked like it did — the same shape a minor is allowed after
`1.0`.

Nothing has renamed or removed a documented field or key. There has not been a
major, and the intent is that `1.0` is the first one that could be.
