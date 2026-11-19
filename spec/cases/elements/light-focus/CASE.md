A light element is in the page's DOM, so a `<label for>` outside it reaches
an input inside it. It never replaces a child, so a re-render leaves the
focused input focused, and the same node.

Source: `/docs/accessibility`, the rows for a light element.
