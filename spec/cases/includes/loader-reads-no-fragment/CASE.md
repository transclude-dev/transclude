An included route's loader reads `ctx.fragment` as `null`. One load serves
every fragment of the route that the page includes, so one name would be
wrong for the others. A request for the fragment itself still reads its name.

Source: `/docs/includes`, "A fragment of another route", and
`/docs/fragments`, on `ctx.fragment`. The second include drill found it.
