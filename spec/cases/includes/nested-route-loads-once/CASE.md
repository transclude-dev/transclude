A route included from the page and again from inside another included route
runs its loaders once for the request. Both copies print the same count.

Source: `/docs/includes`, "A fragment of another route", which says one route
included twice runs its loaders once. The second include drill found it.
