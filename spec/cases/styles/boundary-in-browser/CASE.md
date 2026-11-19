What crosses a boundary, in Chrome. A custom property on `:root` reaches
inside a shadow root, a global class lands on a light element and stops at a
shadow root, and `::part()` styles the node an element exposes.

Then the element's own rule against the page's. A light element's `:scope`
rule loses to a page rule of the same specificity, because the element's
styles sit in the `transclude` cascade layer and page CSS outside a layer
beats a layered rule. Without the layer, `@scope` proximity made the element
win. A page rule on a shadow element's host beats its `:host` rule, because
a normal declaration from the document wins over one from the shadow tree.
Page CSS reaches the host and nothing inside it.

Source: `/docs/styles`, "What crosses a boundary" and "The element itself".
