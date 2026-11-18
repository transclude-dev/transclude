A listener on `document`, `window` or `globalThis` with no `signal` is
reported, and a boolean third argument counts as no `signal`. A listener on the
element or on any other name is not reported, and neither is one whose
options are a variable.

Source: the gotcha "A listener on `document` outlives the element that added
it" in `design/internals.md`.
