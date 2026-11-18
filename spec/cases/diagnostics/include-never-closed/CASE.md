An include written `<transclude … />` is never closed: HTML reads `/>` as
`>`, and the rest of the page would become its fallback.

Source: `/docs/refusals`, the refusal at `src/compiler/codegen.js:908`.
