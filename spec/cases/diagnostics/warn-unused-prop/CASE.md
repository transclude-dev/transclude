A prop named only in a comment is reported as unused. A prop used on a line
after a URL is not, because `//` after a colon is a scheme and not a comment.

Source: the gotcha "The unused-prop check reads code and skips comments, and
the `[^:]` in that regex is doing real work" in `design/internals.md`.
