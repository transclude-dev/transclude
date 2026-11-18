A fragment name that is a property of every object, such as `constructor`,
`__proto__` or `toString`, answers 404 like any other unknown name. A POST
naming one answers 404 before its action runs.

Source: the gotcha "A region name is attacker input, so look it up with
`Object.hasOwn`" in `design/internals.md`.
