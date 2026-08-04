# Voice

How the docs, the README, the site and anything else written here are
written. Code comments have their own rule in `CLAUDE.md`. The same economy
applies to them.

## The shape of a page

A reader arrives not knowing what the thing is. Give them, in order:

1. **What it is.** One sentence.
2. **The smallest example that runs.** Real file names, real URLs.
3. **What they get.** The output, the status, the file on disk.
4. **The options.** Only after the main path works.
5. **The edges.** Marked as notes, at the end.

Show before you qualify. A caveat in the first paragraph costs every reader
and matters to few of them.

## Sentences

- **Declarative.** State what is, not what the reader could do. "Routes are
  Hono handlers", not "You can use Hono handlers as your routes."
- **One idea per sentence.** Short, active, present tense.
- **Second person for instructions.** "Add an `id`." The framework is
  described. The reader is addressed.
- **Economy.** Every word earns its place.
- **Self-sufficient.** A sentence that needs the next one to make sense is
  rewritten.

## Words

Short and plain. No jargon. Someone reading English as a second language
gets it on the first pass. American spelling. No em dashes.

`hypermedia`, `element` and `fragment` are the exceptions. They name things
this framework is about, so use them and say what they mean the first time.

Never:

| | |
| --- | --- |
| selling | simply, just, easy, powerful, seamless, blazing, feel free |
| hedging | basically, essentially, in order to, it's worth noting |
| filler | note that, keep in mind, as you can see, of course |

"Simply" is the tell. If a step is simple, saying so adds nothing. If it is
not, the word blames the reader.

## Examples

Concrete. `notes.html`, `/notes`, `notes.all()`. Not `<your-page>` or `foo`.

An example is complete when it runs. A snippet needing an import the reader
has to guess is not an example.

Say what it produces. "`GET /notes?fragment=list` returns the `<ul>` and
nothing else." A reader who cannot check the result cannot tell whether they
followed along.

## Current, not historical

Describe what the framework is today. Never name a concept only to deny it.
A reader who never knew about a `pages/` directory does not need to be told
it is gone.

Commit messages are the opposite. They record why, including what was tried
and what broke.

## Depth

The docs serve a first-week reader and a tenth-year one. The main path is for
the first. The reasoning behind a decision goes in a note, in
`/docs/decisions`, or in `CLAUDE.md`, where the second reader will look for
it and the first will not trip over it.

## Before and after

> Litho gives you a simple and powerful way to define routes: you can just
> use plain Hono handlers, which makes it really easy to get started.

> Routes are Hono handlers.

The second one is shorter, and it is also the only one of the two that says
anything.
