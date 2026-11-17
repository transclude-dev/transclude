Redirects are followed one hop at a time, and each hop is checked again. A
redirect to an allowed host is followed. One to a host not in `allow` is
refused, and that host is never read. More hops than `redirects` is refused.

Source: `/docs/includes`, "Limits".
