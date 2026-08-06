<h1 align="center">transclude</h1>

<p align="center">An HTML-first server-side web framework.</p>

<p align="center">
  <a href="https://github.com/transclude-dev/transclude/actions/workflows/ci.yml"
    ><img alt="CI" src="https://github.com/transclude-dev/transclude/actions/workflows/ci.yml/badge.svg"
  /></a>
  <a href="https://www.npmjs.com/package/@transclude/core"
    ><img alt="npm" src="https://img.shields.io/npm/v/%40transclude%2Fcore?color=0b7285"
  /></a>
  <a href="https://transclude.dev/docs/runtimes"
    ><img alt="node" src="https://img.shields.io/node/v/%40transclude%2Fcore?color=0b7285"
  /></a>
  <a href="https://github.com/transclude-dev/transclude/blob/main/LICENSE"
    ><img alt="MIT" src="https://img.shields.io/npm/l/%40transclude%2Fcore?color=0b7285"
  /></a>
  <a href="https://bsky.app/profile/transclude.dev" rel="me"
    ><img alt="Bluesky" src="https://img.shields.io/badge/Bluesky-transclude.dev-0b7285"
  /></a>
</p>

HTML is the product. A page is an `.html` file, the directory tree is the route
table, and any fragment of a page is a URL of its own.

The same app runs on Node, Bun, Deno and workerd, the runtime behind
Cloudflare Workers, and ships no client JavaScript by default.

**[transclude.dev](https://transclude.dev)** has the documentation, and
[every example is running](https://transclude.dev/docs/examples).
[todomvc.transclude.dev](https://todomvc.transclude.dev) ships zero bytes of
JavaScript, which is easier to believe with the page open.

```sh
npm create @transclude my-app
cd my-app
npm install
npm run dev
```

## What a page looks like

```html
<script server>
  import { notes } from '../data/notes.js';

  // Answers GET. Whatever it returns is what the template reads.
  export default async () => ({ notes: notes.all() });

  // Answers everything else. A <form method="post"> reaches this.
  export const POST = async ({ request, url }) => {
    notes.add((await request.formData()).get('text'));
    // 303, so a reload is a GET and does not submit again.
    return Response.redirect(new URL(url).origin + '/notes', 303);
  };
</script>

<title>Notes</title>

<form method="post">
  <input name="text" required />
  <button>Add</button>
</form>

<!-- An id plus `fragment` makes this a resource: /notes?fragment=list -->
<ul id="list" fragment>
  <li each="note of notes">${note.text}</li>
</ul>
```

That page works with JavaScript turned off. It also answers
`GET /notes?fragment=list` with just the `<ul>`, from the same compiled markup,
so a swap cannot drift from the page it replaces part of.

## What is in it

- **Pages and endpoints.** An `.html` file responds to GET; its `POST`, `PUT`,
  `PATCH` and `DELETE` exports answer the rest, so a plain `<form method="post">`
  works. A `.js` file in the same tree returns a `Response`.
- **Fragments.** Mark an element `fragment` and it has a URL of its own. htmx,
  Turbo or a short `fetch` swaps it in. The framework ships nothing that does.
- **Includes.** `<transclude src="#id">` puts a fragment in a second place,
  `src="/other#id"` reads another route of the app, and `src="https://…#id"`
  reads a document somebody else wrote, through an allowlist.
- **Elements.** An `.html` file in `app/elements/` becomes a custom element.
  Light DOM by default: no boundary, page CSS reaches it, `<label for>` works,
  and it ships no JavaScript. `export const shadow = true` opts into a shadow
  root and a re-render on an attribute change.
- **Types without writing TypeScript.** `npm run check` catches a misspelled
  field, an unknown prop and a wrong-typed one, from the shapes your loaders
  return. Annotations are optional.
- **A build that is files.** Prerendered pages, compressed once at rest, with a
  strong ETag per encoding. `dist/static` is self-contained.

## What it does not do

- **No client-side router, and no swapper.** Every link is a document request
  unless you bring something that swaps. That is a decision, not a gap.
- **A page does not stream.** Its body is buffered so it can be hashed, which is
  what buys the ETag. A `Link: rel=preload` goes out first, so a proxy can turn
  it into a 103 while the page is still being made. An endpoint returns a
  `Response` you build, so it can answer with a `ReadableStream` and stay open.
- **No session store and no database opinion.** Signed cookies are the building
  block.
- **No byte ranges on workerd.** A Range request gets 200 rather than 206.
  Ranges are what a filesystem buys, and a worker has none.
- **`@scope` is soft scoping.** A light element's styles lose to page CSS of
  equal specificity: right for content, a hazard for widgets.

## The packages

| | |
| --- | --- |
| [`@transclude/core`](https://www.npmjs.com/package/@transclude/core) | the framework |
| [`@transclude/create`](https://www.npmjs.com/package/@transclude/create) | `npm create @transclude` |

## Working on it

```sh
npm install
npm test              # the framework's own, and they need no app
npm run test:examples # the examples', against a build
npm run showcase      # the showcase on http://localhost:1961
npm run todomvc       # TodoMVC on http://localhost:1962
npm run blog          # a prerendered blog on http://localhost:1963
npm run search        # search over a fragment on http://localhost:1964
npm run htmx          # the same, driven by htmx, on http://localhost:1965
npm run includes      # transclusion on http://localhost:1966
npm run auth          # a guarded section on http://localhost:1967
npm run live          # server-sent events on http://localhost:1968
npm run elements      # light and shadow elements on http://localhost:1969
npm run check:src     # type-check the framework itself
```

`examples/` holds apps built against this package the same way any other project
would be. Every one of them is deployed, from the same source you would clone.

| Example | What it proves | Running |
| --- | --- | --- |
| `todomvc` | Seven actions, one POST handler, zero bytes of JavaScript | [todomvc.transclude.dev](https://todomvc.transclude.dev) |
| `search` | A fragment that is a substring of the document it came from | [search.transclude.dev](https://search.transclude.dev) |
| `blog` | Markdown to files, with a sitemap and a feed | [blog.transclude.dev](https://blog.transclude.dev) |
| `htmx` | htmx and this framework, each doing its own half | [htmx.transclude.dev](https://htmx.transclude.dev) |
| `includes` | One piece of markup rendered in more than one place | [includes.transclude.dev](https://includes.transclude.dev) |
| `auth` | A section behind a layout and a signed cookie | [auth.transclude.dev](https://auth.transclude.dev) |
| `live` | Server-sent events into a fragment | [live.transclude.dev](https://live.transclude.dev) |
| `elements` | A light element and a shadow one, side by side | [elements.transclude.dev](https://elements.transclude.dev) |
| `showcase` | Every feature at once, and where the browser checks live | [showcase.transclude.dev](https://showcase.transclude.dev) |

The browser checks are in `showcase` because they need an app to run against.
`www/` is the site at transclude.dev: a landing page, the documentation under
`/docs`, the writing under `/blog`, and itself built with the framework.

### Trying the CLI against this checkout

```sh
cd create && npm link && cd ..            # once, puts create-transclude on PATH
create-transclude my-app --template blank --link
```

`--link` points the new project at this checkout rather than the registry, which
is what you want while changing the framework: an edit here is an edit there.

## Working with an AI agent

`skills/transclude/` is an [Agent Skill](https://agentskills.io): the framework's
conventions, its API and the mistakes it refuses, in the format Claude Code,
Cursor, Copilot and others read. It ships with the package, so an installed
project has it at `node_modules/@transclude/core/skills/transclude/`.

Every HTML example in it is compiled by the real compiler in `npm test`. A skill
is documentation an agent acts on without a human reading it first, so an
example that stops compiling is worse than a missing one.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers the layout, the tests and the writing
style. Everyone taking part agrees to the
[Code of Conduct](CODE_OF_CONDUCT.md).

Security problems go to admin@dakroub.co, not to a public issue.

## License

MIT
