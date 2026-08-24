# transclude for VS Code

Diagnostics, hovers and syntax highlighting for the `.html` files of a
[transclude](https://transclude.dev) project.

A page here holds script blocks that are separate modules, which the editor's
built-in HTML support reads as one. This extension understands the real shape:
`${…}` is an expression, a misspelled field is an error with a line number, the
same ones `npm run check` reports, and a directive is an expression rather than
a string.

That last one is the visible difference. `each="ink of inks"` colors `ink` as
the name it declares, `of` as an operator and `inks` as the expression it is.
`if="hop.count > 1"` keeps its `>` inside the value instead of ending the tag.

## How it works

The extension ships no checker. It starts the language server that comes with
your project's own `@transclude/core`, so the diagnostics match the framework
version you build with. A workspace without a `transclude.config.js` is left
alone.

## Settings

- `transclude.enable`: type check `.html` files in a transclude project. On by
  default.

## Building it yourself

```sh
cd editor/vscode
npm install
npx @vscode/vsce package
code --install-extension transclude-0.1.0.vsix
```
