Each element has its own copy of its state. Each name is a property, setting
one re-renders, and `updateComplete` resolves once the render is written. A
boolean field is a custom state, which CSS selects with `:state()`, and it
lands with the render rather than with the assignment.

Source: `/docs/elements`, "State" and "Styling on state". The use is the docs
example as printed.
