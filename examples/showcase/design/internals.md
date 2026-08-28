# Internals

How this app is put together, and what has broken in it before. It is an ordinary
project that happens to sit in the framework's repository: `@transclude/core` is a
dependency, from `file:../..`. The framework's own notes are in
`design/internals.md` two directories up; these are the ones about writing and
running an app.

`npm test` (this app's own files) · `npm run check` · `npm run dev` ·
`npm run preview`

## Layout

- `app/routes/`. Extension decides: `.html` is a page, `.js` is an endpoint. A
  helper here needs a `_` prefix or it becomes a URL.
- `app/elements/` holds every custom element. Light DOM unless the file exports
  `shadow`, which either script block can carry.
- `app/routes/check.html`. The assertions that run in a browser. The framework has
  no browser coverage of its own, so this is it.
- `app/server.js`. This app's own Hono middleware.
- `worker.js`, `test/`, `transclude.config.js`. The app's wiring, at the root.

## Gotchas

- **`export const prerender = false`** on any page that reads the request.
  `build.js` prerenders every static route otherwise.
- **`moveBefore` is Chrome 133+.** Safari falls back to `insertBefore`, which
  costs focus and nothing else. Measured. `captureFocus` carries it across. Node
  identity, input values, caret and component state all survive. Safari 26.4 has
  no `moveBefore`, so it is the browser that runs this path in `check.html`, and
  it passes there. Chrome 150 and Firefox 152 both have it.
- **The `<svg>` fixture draws nothing anyone reads.** `shape-field` is three
  repeated blocks under an `<svg>`: one keyed, one not, and one inside
  `<foreignObject>`. `check.html` re-renders each of them and reads the namespace
  back off what returned, because a re-render used to parse them into the HTML
  namespace, where they carry every right attribute and paint nothing. Node
  models no namespaces at all, so this is the only place the question can be
  asked.
- **VS Code joins all `<script>` blocks** into one virtual module, so every file
  looks like a redeclaration. `.vscode/settings.json` turns
  `html.validate.scripts` off.
- **Listen on `this.shadowRoot`, not on `this`, if the handler looks at the
  target.** A click inside a shadow root does reach a listener on the host, but
  the target has been retargeted by then: `event.target` is the host element,
  because not seeing through the boundary is what a boundary is for.
  `closest("[data-tag]")` from there finds nothing and the button does nothing,
  quietly. `<tag-picker>` shipped that way and no test noticed.
  `event.composedPath()[0]` also works from the host, but listening on the right
  side of the boundary needs no comment. A handler that ignores the target, like
  `user-card`'s toggle, is fine on either.
- **ARIA state needs the word, so `${boolean}` is wrong for it.** An interpolated
  boolean goes through the framework's attribute rule: `false` drops the attribute
  and `true` writes it bare. That is right for `disabled` and wrong for
  `aria-expanded` and `aria-pressed`, where a missing attribute and `=""` both
  mean no state to a screen reader. Write `${open ? 'true' : 'false'}`.
- **`export const formAssociated` has to be a literal.** It becomes a static
  class field, the same for every element of the tag, so a computed value would
  look like a per-element choice and could not be one. `shadow` is the same. A
  light element can opt in too: being a form control needs no shadow root, and it
  counts as behavior for the "nothing to define, so define nothing" rule, because
  an element that submits a value has to exist to do it.
- **`static formAssociated` can only be checked in a browser.** Nothing in Node
  models a form, so setting it to `false` broke no test until one read the flag
  directly. Whether a `<form>` counts it as a field is checked in
  `app/routes/check.html`.
- **`/check?report` is how any browser reports back.** The page posts its results
  to `/api/checks` and the dev server prints them. Neither Safari nor Firefox can
  be driven from a shell without setup: Safari needs "Allow remote automation"
  turned on by hand, and Firefox needs geckodriver installed. Posting the results
  needs neither, so `open -a Safari 'http://localhost:1961/check?report'` and read
  the log. It also reports a crash, which is the difference between a browser that
  failed and a browser that never ran the page.
- **`npm run test:browser` is the same report, read by a machine.**
  `scripts/browser.js` serves the built app on 1971, opens `/check?report` in
  headless Chrome, and reads the outcome from `GET /api/checks`, which holds the
  last report this process received. No driver protocol and no dependency: the
  page already posts, so the script only has to ask. CI runs it on every push,
  which is what the checks lacked: they ran when somebody remembered to open the
  page. Not 1961, because a dev server left running would answer the health check
  and the report would describe source rather than the build.
- **Vite warns about a public file it does not own.** `transformIndexHtml` warms
  up every `<script type="module" src>` in the served HTML, so a `<script head
  src="/theme.js">` logs `Failed to load url /theme.js. Does the file exist?` on
  every page load. It does exist and Hono serves it. Returning it from a plugin's
  `resolveId` as external does not stop the load, and letting Vite serve the
  public directory is the dev and production split this avoids. Live with it.
- **A rename has to cover `dataset.x` as well as `data-x`.** `data-hf` became
  `data-transclude` everywhere and `s.dataset.hf` in `check.html` did not, so
  `adoptStyles` looked fine and one browser check failed. Nothing in Node models
  `dataset`, so the whole Node suite passed. The browser checks caught it.
- **Check that the listener is yours before believing a server test.** Three wrong
  diagnoses so far. "Something is listening on :1961" is not the check. A server
  someone else started, including the person you are helping, in their own browser,
  answers happily and serves an old `dist`, while your own `npm start` dies with
  `EADDRINUSE` into a log you did not read. Kill the port, wait for it to free,
  start, then confirm the listener is younger than the build:

  ```sh
  pid=$(lsof -nP -iTCP:1961 -sTCP:LISTEN -t); [ -n "$pid" ] && kill $pid
  for i in $(seq 20); do lsof -nP -iTCP:1961 -sTCP:LISTEN -t >/dev/null || break; sleep 0.5; done
  # start it, then:
  ps -o lstart= -p "$(lsof -nP -iTCP:1961 -sTCP:LISTEN -t)"   # vs. stat -f %Sm dist/server/entry.js
  grep -c EADDRINUSE <the server log>                          # must be 0
  ```
- **A message in the URL is not a flash message.** `?added=x` after a redirect
  looked tidy and was reported as a bug. Any GET of that URL announced a note that
  was never added, and after a server restart the in-memory list was empty while
  the message stayed. It can be replayed, it can be shared, and it outlives what it
  describes. A flash is a short-lived signed cookie the loader reads and then
  deletes, which is the one thing that crosses a redirect exactly once.
- **`curl -L` does not send a cookie the redirect set on the hop it follows.** It
  arrives on the next request instead. A browser does send it, so a flash looks
  broken under curl and works in practice. Check this one in a browser.
- **An action that changes data must answer with a redirect.** Returning rendered
  markup from a POST leaves the browser on a POST, so every reload submits the form
  again. Reported by holding down refresh and watching a list grow. Use 303, not
  302: 303 is the one that turns the next request into a GET. The exceptions are a
  rejected submission, which changed nothing, and a `fragment` request, which asked
  for markup and cannot use a redirect. `build.test.js` guards it.
- **A background tab slows `setTimeout` to about once a second.** A poll loop in
  `check.html` that finished in a second when focused hung for minutes when not.
  Wait on a `MutationObserver`, which is not slowed, and use a timer only to give
  up.
- **`ctx.action` is the union of what the page's own verb exports return.** So handlers
  that return different shapes leave the loader unable to read either. Return one
  shape from all of them. `Response` is left out of the union on purpose: returning
  one answers the request, so the loader never sees it.
- **Middleware does not run during `npm run build`.** A page behind a guard has to
  `export const prerender = false`, or the build writes a logged-out copy to a file
  and the guard never sees a request for it.
- **`COOKIE_SECRET` lives in `.env`, and each runtime loads it differently.** Node
  needs `--env-file-if-exists=.env`, in the `dev` and `start` scripts. Deno needs
  `--env-file`. Bun reads `.env` on its own. Wrangler reads `.dev.vars`, so
  `.dev.vars` carries a copy of the same value. Adding a Node flag to the Bun or
  wrangler script would break it. `.env.example` is the committed template. `.env`,
  `.env.*` and `.dev.vars` are ignored.
- **A `Response` body can be read once, so never share one.** A module-level
  `const badRequest = new Response(...)` returned from an action worked for the
  first request and then answered 200 with a rendered page, because the body was
  already read. Build them in a function. This one bites because returning a
  `Response` is now the convention in three places: loader, action, endpoint.
- **An endpoint must return a `Response`.** There is no template to fall back to,
  and a handler returning a plain object has forgotten `Response.json`. Verb
  handlers are uppercase because `export const delete` is a syntax error and
  `export const DELETE` is not. A page's handlers are spelled the same way.
- **A `.js` file in `routes/` is a route.** A helper that lives there needs the `_`
  prefix, or it becomes a URL. The dev watcher rebuilds the route table for `.js`
  as well as `.html`. It only watched pages at first, so adding an endpoint needed
  a restart and a 404 was the only hint.
- **Four runtimes, one app, checked.** Node, Bun, Deno and workerd all answer the
  same way over ten routes: same 301, same 403 on a forged post, same `Set-Cookie`,
  same 304. The Node, Bun and Deno adapters come from the package. `worker.js` is
  this app's, because every import in it names something the app owns, and each
  difference from Node is one argument to `createApp`: bytes (`dist/server/assets.js`
  instead of a disk), hashing (WebCrypto, which is why `hash` is awaited),
  compression (`null`, because the edge does it), public files (a handler over the
  same map), and config (see below). There is one real difference in behavior. A worker
  serves no byte ranges, so a Range request gets 200 rather than 206, because
  ranges need a filesystem.
- **On a worker, config arrives with the request, not the process.** There is no
  `process.env`, so `worker.js` builds the app on the first request from `env`. Reading a secret at import gave `undefined` and signing then refused. That
  is correct and confusing at the same time, because the variable was set.
  `transclude.config.js` uses `globalThis.process?.env` for the same reason: a bare
  `process` is a ReferenceError there before anything runs.
- **Workers has no JSON module type.** `dist/routes.json` arrives as a string under
  a Text rule, and using it as an object gave a route table of `undefined` and a
  site of 404s that looked like a routing bug. The adapter parses it.
  `fallthrough: true` on that rule matters too, or it replaces the default text rule
  rather than adding to it.
- **Strip comments before grepping source in a test.** Two guards failed on the
  comment that explains the rule rather than on code breaking it, and `test/` here
  greps `worker.js` and the config the same way.
- **Use `fileURLToPath`, never `url.pathname`.** A space in the project path stays
  percent-encoded in the second one, and `Atelier%20Dakroub` is not a directory.
  That is how the extraction above broke on the first run.
