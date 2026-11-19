A form-associated element behaves like an input. Its value is submitted under
its `name` and `FormData` reads it. `setValidity` makes `:invalid` match and
blocks a submit. A `<fieldset disabled>` gives it the `disabled` custom state,
not the attribute, and a fieldset that re-enables clears it.

Source: `/docs/elements`, "An element a form can submit", "Saying it is
invalid" and "A disabling container". The element is the docs example with
the validity member added, with one change: the message points at the inner
`<button>`, not at the element. The docs pass `this`, which a light element
cannot focus, and Chrome then shows no message and logs "An invalid form
control with name='tags' is not focusable."

