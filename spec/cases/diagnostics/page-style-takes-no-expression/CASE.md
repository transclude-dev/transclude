`${}` in a page's own top-level `<style>` is a compile error, as it is in one
inside the markup.

Source: `/docs/security`, "Scripts and styles take no expressions".

Marked `todo`. The top-level `<style>` is the page's stylesheet, sent as
written, so `${color}` reaches the browser as those characters and nothing
says so. Joe decided the build should refuse it. An element's top-level
`<style>` is likely the same, and the fix should check.
