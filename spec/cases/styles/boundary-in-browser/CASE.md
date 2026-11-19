What crosses a boundary, in Chrome. A custom property on `:root` reaches
inside a shadow root, a global class lands on a light element and stops at a
shadow root, and `::part()` styles the node an element exposes.

Then the element's own rule against the page's. The second entry records
what Chrome does, which is not what `/docs/styles` says:

- A light element's `:scope` rule wins against a page rule of the same
  specificity. The style is hoisted as `@scope (light-note) { … }`, and when
  specificity is equal, scoping proximity decides before source order does.
  The docs say it loses.
- A page rule on a shadow element's host beats the element's `:host` rule,
  because a normal declaration from the document wins over one from the
  shadow tree. The docs say page CSS cannot reach `:host`.

Source: `/docs/styles`, "What crosses a boundary" and "The element itself".
