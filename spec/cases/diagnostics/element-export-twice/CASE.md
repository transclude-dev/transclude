An element may not export the same name twice. The JavaScript parser refuses
the duplicate before the compiler's own check can, so the message is the
parser's, with the file and the line.

Source: `/docs/refusals`, the refusal at `src/compiler/script.js:224`. That
check is not reachable from an `.html` file while the parser comes first.
