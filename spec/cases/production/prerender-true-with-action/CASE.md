`export const prerender = true` lets a page with an action be a file. The
build writes it, `GET` answers the file before and after a `POST`, and the
`POST` still runs the action. The loader says which made the page: a request
or the build, which hands it a `null` request.

Source: `/docs/production`, the note "Forgetting it stops the build".
