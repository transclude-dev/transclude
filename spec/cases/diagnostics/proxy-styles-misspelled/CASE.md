`proxy.styles` is `'keep'` or `'strip'`. Any other value stops the build,
because a misspelling would keep every `style` attribute and look like the
setting worked.

Source: `design/internals.md`, "`<base>`, `<link>` and `<style>` are stripped from foreign markup for the host page's sake, not the fragment's."
