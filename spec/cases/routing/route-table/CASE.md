A file's path is its URL. `about.html` is `/about`, `people/index.html` is
`/people`, `people/[name].html` is `/people/:name` with the segment in
`params.name`, `docs/[...path].html` takes every segment below `/docs/`, and
`api/ping.js` is an endpoint. The loader block never reaches the page.

Source: `/docs/routing`, the route table and "The loader".
