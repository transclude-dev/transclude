CSRF is on by default for non-GET requests with a form content type. A form
post with no `Origin`, or a foreign one, is refused with 403. A same-origin
form post, a JSON post and a `GET` go through.

Source: `/docs/forms`, "CSRF".
