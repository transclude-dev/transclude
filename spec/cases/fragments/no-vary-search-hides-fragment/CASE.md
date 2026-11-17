A `No-Vary-Search` that hides `?fragment=` is refused: the request answers 500
rather than a page a cache could hand out for every fragment URL.

Source: `/docs/fragments`, the note "A header that hides the parameter is
refused".

The message naming the header goes to the server's log, which the runner does
not read yet. The 500 still carries `No-Vary-Search: except=()`.
