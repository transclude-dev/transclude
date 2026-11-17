A light element's slots are filled on the server, and no `<slot>` is sent. A
child with `slot="aside"` fills the named slot and keeps its attribute, a
`<template slot="footer">` fills one with its content, and the rest fill the
default slot. A slot left empty shows its fallback.

Source: `/docs/elements`, "What `<slot>` means in each".
