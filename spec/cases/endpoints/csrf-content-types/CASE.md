CSRF guards every method but `GET` and `HEAD`. From another origin, a JSON
post reaches the handler, and a form-encoded, multipart, `text/plain` or
untyped one answers 403.

Source: `/docs/endpoints`, "Webhooks", the table and the note "No content type
counts as text/plain".
