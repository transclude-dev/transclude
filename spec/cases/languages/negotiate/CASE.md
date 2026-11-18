The docs middleware reads `Accept-Language` on the bare path and redirects to
the first locale the app has, or to `/en`. Each locale keeps its own URL.

Source: `/docs/languages`, "Sending a reader to their own language".
