What a foreign fragment loses: scripts, frames, plugins, event handlers,
`javascript:` URLs (a tab in the scheme too), `data:` outside an image,
`<base>`, `<link>`, `<style>`, SVG `<animate>` and `<set>`, comments, and the
raw-text elements. A `<template>` and a declarative shadow root are cleaned
inside. A `style` attribute is kept, and a custom element arrives inert.

Source: `/docs/includes`, "What arrives".

The source's own `<base>` still sets the base its relative URLs resolve
against, so `/safe` in it points at that host. That is where the source's own
page points it.
