# Contributing

Thanks for looking. This is a small project, so a question in an issue is
welcome before you write anything.

Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

```sh
git clone https://github.com/transclude-dev/transclude.git
cd transclude
npm install
npm test
```

`npm test` runs the framework's own tests. They need no app and take a few
seconds. A change that makes them need an app is a boundary breaking, and the
next section says which one.

## What lives where

This repository is the package. Two things in it are not.

| | |
| --- | --- |
| `src/`, `bin/`, `test/` | the framework |
| `create/` | `@transclude/create`, the project starter |
| `examples/showcase/` | an app, installed from `file:../..` like any other |
| `www/` | the site at transclude.dev |

`examples/showcase` and `www` depend on the package by name. Nothing in the
package reaches into either one, and a test says so. That boundary is the
reason both exist: if the framework can only be used the way an installed
package is used, it works installed.

`design/internals.md` holds the layout in detail and a long list of gotchas. Read
the gotcha that covers the area you are changing. Most of them were written after
something broke quietly.

## Running things

```sh
npm test              # the framework's own
npm run test:examples # the showcase, against a build
npm run test:www      # the site
npm run showcase      # the demo on http://localhost:1961
npm run www           # the site on http://localhost:1980
npm run check:src     # type-check the framework itself
```

The browser checks live in `examples/showcase/app/routes/check.html`, because
they need an app to run against. Anything about a real form, a shadow root or
a `dataset` has to be checked there. Nothing in Node models those.

### Trying the CLI against this checkout

```sh
cd create && npm link && cd ..    # once, puts create-transclude on PATH
create-transclude my-app --template blank --link
```

`--link` points the new project at this checkout rather than the registry,
which is what you want while changing the framework: an edit here is an edit
there.

## Tests

The rule the tests are built on: **after `bind` and `update`, the DOM must
serialize to exactly what a full render of those props produces.** One
assertion catches index errors, bad splits, escaping drift and missed
attributes.

**Falsify before trusting.** Break the mechanism on purpose and confirm that
its own test fails. A test that passes both ways is not a test. Several gaps
here were found exactly that way, including three tests that were checking
nothing at all.

## Style

Code comments: one to three sentences. Add one only when it says something the
code cannot. Leave it out otherwise.

Prose: [`design/voice.md`](design/voice.md). Short plain words, American
spelling, no em dashes, declarative. A docs page says what the thing is, shows
the smallest example that runs, says what the reader gets, then the options,
then the edges as notes. Two of those rules are tested in `www/test`.

Commit messages are the opposite of the docs. The docs describe what is;
a commit records why, including what was tried and what broke.

## Pull requests

One branch per change. Say what broke or what was missing, and how you
checked. If you changed compiler output, say which test would have caught the
old behaviour.

A change to a gotcha in `design/internals.md` is part of the change, not a
follow-up.

## Reporting a bug

Open an issue with the smallest page, element or config that shows it, and say
which runtime you saw it on. A `.html` file that reproduces is worth more than
a description of one.

## Security

Do not open a public issue for a security problem.
[SECURITY.md](SECURITY.md) says where to send it and what to include.

## License

By contributing you agree that your work is released under the
[MIT license](LICENSE), the same as the rest of the project.
