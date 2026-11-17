How far a fragment of a foreign document reaches. A heading takes everything
up to the next heading of its rank or above, and never leaves its parent. A
`<dt>` takes its definitions up to the next term. Anything else is itself. An
empty inline element is a bookmark for the element after it, one hop; one
holding text or an image is content.

Source: `/docs/includes`, "How extent is worked out".
