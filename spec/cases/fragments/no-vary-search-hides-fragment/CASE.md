A `No-Vary-Search` that hides `?fragment=` is refused: the request answers 500
rather than a page a cache could hand out for every fragment URL.

Source: `/docs/fragments`, the note "A header that hides the parameter is
refused".

The message naming the header goes to the server's log, and each entry checks
it there. The 500 is its own answer: none of the page's headers, so no ETag,
no `public` caching and no `Content-Length` of a body it does not carry.
