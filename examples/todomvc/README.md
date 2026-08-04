# TodoMVC

[TodoMVC](https://todomvc.com) with forms and nothing else. Add, edit, toggle,
delete, filter and clear, in one `.html` file, shipping zero bytes of
JavaScript.

```sh
npm install
npm run dev     # http://localhost:1963
```

## What to look at

`app/routes/index.html` is the whole app. A `<script server>` block on top
holds the loader and the `POST` handler; the markup under it is the page.

**Every control is a submit button in its own form.** The round toggle, the
`×`, "Mark all as complete" and "Clear completed" are all `<button>` elements,
each in a small form carrying a hidden `intent`. A submit button's name and
value are sent only when it is the one that submitted, so one page handles
seven actions with no client router and no `fetch`.

**Editing is a link.** Clicking a todo goes to `?editing=3`, and the loader
renders that row as a text field instead of a label. No double-click handler,
and the state survives a reload because it is in the URL.

**Filtering is a link too.** `?show=active` and `?show=completed` are read by
the loader. An unknown value falls back to `all` rather than showing an empty
list.

**Every change redirects.** The handler returns a 303 to the same URL, keeping
the filter and dropping `editing`. A reload after adding a todo does not add it
twice.

## What it leaves out

No persistence: the list lives in `app/data/todos.js`, in memory, and one
process holds one list. Everybody looking at the running app sees the same
todos, which is wrong for a real app and useful for a demo you open in two
windows. Swap that file for a database and nothing above it changes.

No client JavaScript, which is the point. `curl localhost:1963 | grep script`
finds nothing. A test asserts it.

## Tests

```sh
npm run build && npm test
```

They ask the built app for URLs and read what comes back, with nothing stubbed.
