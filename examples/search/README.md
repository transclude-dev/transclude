# Search

Search as you type, over a fragment. The same markup answers a whole request
and a swap, and the page works with the script turned off.

```sh
npm install
npm run dev     # http://localhost:1965
```

## What to look at

**The results are a fragment.** `<div id="results" fragment>` gives that element
a URL of its own, so `/?q=form&fragment=results` returns the list and nothing
else: no `<head>`, no layout, no second template.

**Both paths render the same markup.** A test asserts that the fragment is a
substring of the whole document, which is what makes them impossible to drift
apart.

**With no JavaScript, the form submits.** `method="get"` puts the query in the
URL and the browser loads the page. That is the whole app, working, before any
script runs.

**With JavaScript, twenty lines swap the fragment.** `app/routes/index.html` ends
with a `<script type="module">` block that fetches the fragment and calls
`setHTMLUnsafe`. This framework ships nothing that does this on your behalf;
htmx and Turbo are the same idea with more written for you.

Two details in those twenty lines are the ones people get wrong. A counter
drops a slow answer that arrives after a newer one. `history.replaceState`
keeps the URL in step, so a reload and a shared link both still work.

## Tests

```sh
npm run build && npm test
```
