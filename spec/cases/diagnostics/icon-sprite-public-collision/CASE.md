`app/icons/` writes `/icons.svg`, so a file of that name in `app/public/`
stops the build. The two servers would answer that URL with different files.

Source: `design/internals.md`, "One thing answers for `/icons.svg`, and the two servers pick opposite winners."
