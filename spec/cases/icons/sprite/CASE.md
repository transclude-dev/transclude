`app/icons/` compiles to `/icons.svg`, one document with a `<symbol>` per
file, named by the file. `viewBox` and the paint attributes are carried over,
and `width` and `height` are dropped. Every icon in the directory is in the
sheet.

Source: `/docs/icons`, "What the build writes".
