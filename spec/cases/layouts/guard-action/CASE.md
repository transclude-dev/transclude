A `POST` to a page under a guard runs the guard first. Signed out, it is a 303
to `/login` and the action does not run. Signed in, the action runs, and the
layout loader runs twice on that request: once before the action and once for
the render after it. The guard count reaches 3: once signed out, twice signed
in.

Source: `/docs/layouts`, the paragraph on actions under a guard.
