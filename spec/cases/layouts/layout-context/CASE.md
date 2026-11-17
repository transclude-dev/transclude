Each layout loads its own data. A loader reads what the chain above it
returned as `ctx.layout`, merged, with the inner value winning: the page sees
`theme` as the docs layout's `dark`, not the root's `light`.

Source: `/docs/layouts`, "Nesting".
