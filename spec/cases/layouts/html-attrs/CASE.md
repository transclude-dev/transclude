`<html>` in a layout sets the document's attributes. They merge by name along
the chain and the innermost wins: the page's `dir="ltr"` beats the layout's
`rtl`. Values are escaped, a bare attribute is written bare, `false` and
`null` drop it, and `lang` is overwritten.

Source: `/docs/layouts`, "Attributes on `<html>` and `<body>`".
