An attribute on a `<script head>` may not interpolate, because the block
is written into `<head>` before any data exists.

Source: `/docs/refusals`, the refusal at `src/compiler/index.js:1133`.
