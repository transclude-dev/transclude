`${…}` escapes its value, so `<script>` arrives as text. `html()` writes a
value as markup, and the page uses it with nothing imported.

Source: `/docs/routing`, "Interpolation".
