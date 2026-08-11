# Markdown

A `.md` file under `routes/` is a page. It answers a URL, it has a loader, its
elements are rendered on the server, and it is type checked. The file is
converted to HTML before anything compiles it, so every step after the
conversion is the step an `.html` page takes.

```sh
npm install
npm run dev     # http://localhost:1970
```

## The framework ships no Markdown parser

`markdown` in `transclude.config.js` is a function from source to HTML. This app
uses `marked`; swapping it is `app/lib/markdown.js` and nothing else. A `.md`
page with no converter is an error naming the file, rather than a guess about
which flavour you meant.

## The loader needs no new syntax

`app/routes/index.md` opens with a `<script server>` block, the same one an HTML
page opens with. CommonMark starts an HTML block at `<script` and ends it at the
closing tag, with everything between passed through raw, so it reaches the
compiler untouched. There is no frontmatter and no YAML.

Never write the closing script tag inside that block, even inside a comment. The
HTML parser ends the script at the first one it sees, and so does Markdown.

## `${` in prose interpolates, `${` in code does not

A page is a template whichever format it was written in, so `${title}` in a
paragraph reads the loader's data. That is almost never wanted in a code sample:
a shell block is full of `${HOME}` and a JavaScript one is full of template
literals.

`app/lib/markdown.js` escapes `${` in code spans and fenced blocks, which is four
lines. Prose is left alone. This is a judgement about how people write rather
than a rule about how pages compile, which is why it lives in the app.

`\${` is the framework's escape and works anywhere in any page.

## Elements need blank lines

An HTML block runs to the next blank line, and Markdown inside one is not parsed.

```md
<site-note>
**Four asterisks.** The whole thing is one raw block.
</site-note>

<site-note>

**Bold.** The blank line above ended the block.

</site-note>
```

Inline is easier: `A <site-badge>new</site-badge> thing` inside a paragraph needs
no blank lines, and the Markdown between the tags is still parsed.

## A diagnostic in a `.md` page points into the converted HTML

`npm run check` type checks Markdown pages, and it says so when it reports one:

```
app/routes/index.md  (converted HTML, line 21)  error  TS2551
```

The line is real and it is not a line in the file you opened. Getting a position
back to the Markdown needs a source map from the conversion, and the conversion
belongs to the app.

## Tests

```sh
npm run build && npm test
```
