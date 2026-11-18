An endpoint answers only the methods on the router's list. A request whose
method names another export, a function or not, answers 405 with `Allow`
naming the verbs the endpoint does export.

Source: the gotcha "A verb is a name on a list, not a shape" in
`design/internals.md`.
