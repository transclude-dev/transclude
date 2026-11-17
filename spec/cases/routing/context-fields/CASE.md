A loader's context carries the full `url` as a string, the captured `params`,
`route.path`, `fragment` (`null` for a document, the name for a fragment), and
the `request`. While the build prerenders a page, `request` is `null`.

Source: `/docs/routing`, "The context".

`route.path` is the path that was asked for, `/people/ada`, and not the
pattern. The docs call it "the matched route, including its path".
