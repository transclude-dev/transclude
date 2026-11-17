A form posts to its own page. The handler runs: a note with text answers 303
to the same URL, and the next `GET` shows it. A post with no text changes
nothing, so the handler returns the error, and the page renders it with no
redirect.

Source: `/docs/forms`, the first example, and "Answer a mutation with a
redirect".
