`json()` alone in a `<script>` writes JSON with `<`, `>`, `&` and U+2028 as
`\uXXXX`, so a value cannot end the element. A style reads a value through a
custom property in a `style` attribute, which is escaped.

Source: `/docs/security`, "Scripts and styles take no expressions".
