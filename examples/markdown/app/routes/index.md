<script server>
  import { notes } from '../data/notes.js';

  // A Markdown page has the same loader an HTML one has. CommonMark starts an
  // HTML block at `<script` and ends it at the closing tag, so this arrives at
  // the compiler untouched. No frontmatter, and nothing new to learn.
  //
  // Never write the closing tag inside this block, even in a comment. The HTML
  // parser ends the script at the first one it sees, and so does Markdown.
  export default async () => ({
    title: 'Markdown pages',
    notes,
    count: notes.length,
  });
</script>

<title>${title}</title>
<meta name="description" content="A .md file under routes/ is a page." />

# ${title}

This page is `app/routes/index.md`. It answers `/`, the same way
`app/routes/index.html` would. The file is converted to HTML, and every step
after that is the one an HTML page takes: the same compiler, the same layouts,
the same fragments, the same type checking.

There are ${count} notes below, and that number came from the loader.

## Prose interpolates

`${title}` in a paragraph reads the loader's data, because a page is a template
whichever format it was written in.

## Code does not

<site-note>

A fenced block is written to be read, not evaluated. This app escapes `${` in
code spans and fences before the compiler sees them, which is four lines in
`app/lib/markdown.js`.

</site-note>

So this shell sample says what it looks like it says:

```sh
echo "${HOME}/notes"
```

And so does this one, which would otherwise be a page that fails to compile:

```js
const greeting = `Hello, ${name}`;
```

## Elements need blank lines

`<site-note>` above is a custom element in `app/elements/`. It is rendered on
the server and ships no JavaScript.

The blank lines inside it are the whole trick. An HTML block runs to the next
blank line, and Markdown inside one is not parsed. With no blank lines the
`**bold**` below would arrive as four asterisks:

```md
<site-note>

**This is bold.**

</site-note>
```

<site-note tone="warn">

**This is bold**, because the blank lines above and below it ended the HTML
block and started an ordinary paragraph.

</site-note>

## Directives work too

The list below is a `<ul each>` written as HTML in the middle of Markdown, which
is allowed and is sometimes what you want.

<ul>
  <li each="note of notes"><strong>${note.title}</strong> — ${note.body}</li>
</ul>

## The rest of the tree

[About](/about) is an ordinary `.html` page in the same directory. Mixing them
is the point: a page becomes Markdown when Markdown suits it and goes back when
it does not, and the URL never moves.
