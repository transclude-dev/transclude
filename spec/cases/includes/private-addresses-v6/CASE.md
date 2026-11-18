An IPv4 address has four spellings in IPv6. A host that resolves to the
metadata address in any of them is refused, and nothing is read from it. A
public IPv4 address in the same form is still public.

Source: `design/internals.md`, "One IPv4 address has four spellings in IPv6, and only one was read."
`includes/private-addresses` has the mapped form, `::ffff:`. This case has
the other three, and the public one.
