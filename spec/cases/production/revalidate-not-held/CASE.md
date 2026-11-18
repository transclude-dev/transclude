A page that read a cookie, set a header, answered with a `Response`, or has a
status outside 2xx is not held, though it sets `revalidate`. Each renders on
every request.

Source: `/docs/production`, "Tags", the list of what is not held.
