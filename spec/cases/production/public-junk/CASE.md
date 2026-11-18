The build copies `app/public/` but leaves out what an operating system writes
there. `/Thumbs.db` and `/desktop.ini` answer 404. A dotfile directory is
copied, so `/.well-known/security.txt` answers 200.

Source: `design/internals.md`, "The public copy skips what an operating system left there."
`.DS_Store` is on the same list. Git ignores it in this repository, so the
case uses the other two names.
