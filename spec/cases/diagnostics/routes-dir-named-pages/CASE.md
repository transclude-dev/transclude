An app with `app/pages/` and no `app/routes/` stops the build with a message
naming the rename, instead of building a site with no routes.

Source: the gotcha "The directory holds routes; a page is one kind of route"
in `design/internals.md`.
