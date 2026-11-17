An attribute value takes `${…}`, whole or in part, several times. `false`,
`null` and `undefined` drop the attribute, `true` writes the name alone, an
object or an array is written as JSON, and anything else is the string,
escaped by attribute rules.

Source: `/docs/routing`, "In an attribute", the example and the table.
