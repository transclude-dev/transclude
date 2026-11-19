With `watchElements`, an element that arrives in a fragment on a page that
never rendered it brings its styles: they are added to `<head>` once, however
many copies arrive, and they apply.

Source: `/docs/styles`, "Styles for swapped-in markup", and `/docs/fragments`,
"Styles for swapped-in markup". The fragment carries no `<style>`, so only a
browser shows the styles arrive.
