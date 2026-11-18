`<html>` inside a comment or a script block is text, not the page's `<html>`.
The document keeps the default `lang`.

Source: the gotcha "`<html>` is read with a second parse, because the
fragment parser drops it" in `design/internals.md`.
