In a shadow element the `<slot>` is real: a child added later is projected
through it, `slotchange` fires, and `assignedNodes()` lists it. In a light
element the server filled the slot, and no `<slot>` reaches the browser.

Source: `/docs/elements`, "What `<slot>` means in each".
