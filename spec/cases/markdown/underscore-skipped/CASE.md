A name that starts with an underscore answers no URL, a directory included.
`routes/blog/_posts/first.md` sits beside the page that reads it. The config
has no `markdown`, and the build still succeeds, so the `.md` file was never
read as a page.

Source: `/docs/markdown`, "Markdown that is not a page".
