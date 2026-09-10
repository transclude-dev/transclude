# Voice

How the docs, the README, the site and anything else written here are
written. Code comments follow the same economy: one to three sentences, and
only where they say something the code cannot.

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

Describe what the framework is today. Say what it does, never what it did and
now does not.

So a page never names:

- A feature, key, directory or spelling that has been removed or renamed. A
  reader who never knew about a `pages/` directory does not need to be told it
  is gone.
- A version this changed in. "A project made before this" dates the sentence
  and tells a reader with a current project nothing.
- A bug we hit, a release that broke something, or a gap the tests used to
  have. Keep the mechanism, drop our history with it: "a loader that reaches
  WebAssembly fails on workerd" is the sentence, and what it cost this site
  on which afternoon is not.
- A behavior we replaced, even as the reason for the current one. "A key
  nothing reads looks exactly like a key that worked" says it. "A misspelled
  key was ignored before that" says the same thing and dates it.

Two places are the exception, and both are read by someone who came looking
for history. `/docs/decisions` says what a version number promises, which
means it may say a minor has broken something. `design/internals.md` is
nothing but history: a gotcha exists because something broke quietly, and
naming the failure is the whole value.

Commit messages are the opposite of a docs page. They record why, including
what was tried and what broke.

`www/test/site.test.js` checks the words that only turn up when a page is
dating itself.

## Depth

The docs serve a first-week reader and a tenth-year one. The main path is for
the first. The reasoning behind a decision goes in a note, in
`/docs/decisions`, or in `design/internals.md`, where the second reader will
look for it and the first will not trip over it.

## Before and after

> Litho gives you a simple and powerful way to define routes: you can just
> use plain Hono handlers, which makes it really easy to get started.

> Routes are Hono handlers.

The second one is shorter, and it is also the only one of the two that says
anything.
