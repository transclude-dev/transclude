`api/[...rest].js` takes every path below `/api/`. A file or a directory whose
name starts with `_` is not a route: `/_helper` and `/_lib/tools` answer 404,
and `api/_shared.js` is imported, not served.

Source: `/docs/endpoints`, "A whole resource" and "Helpers".
