`connected` runs on every connect and is handed a signal that aborts when the
element leaves. `updated` runs after every render. On a disconnect the
function `connected` returned runs first, then `disconnected`. A move
disconnects and connects again.

Source: `/docs/elements`, "Giving it behavior", "A public API" and "Undoing
something".
