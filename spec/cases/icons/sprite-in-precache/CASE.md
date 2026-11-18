The sprite is written into the public output before the precache list is
made, so `/precache.json` lists `/icons.svg` beside the author's own public
files.

Source: `design/internals.md`, "The sprite is written after the public copy and before anything that reads `dist/public`."
