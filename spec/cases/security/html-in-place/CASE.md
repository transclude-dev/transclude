An escaped value cannot open or close anything: a value holding `-->` and
`<em>` arrives as text. Markup through `html()` is written where the template
put it, and the browser reads it as markup, so a `</p>` in it closes the
paragraph around it. A comment ends at the first `-->` in the file, which is
why the rest of the docs' own comment reaches the page as text.

Source: `/docs/security`, the paragraph after "It trusts, it does not clean".
