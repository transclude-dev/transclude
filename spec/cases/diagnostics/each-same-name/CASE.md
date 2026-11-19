A loop's item and index need two names, so `each="tag, tag of tags"` is
refused, with the file and line. Before, the page rendered `0` and `1` where it
wrote `${tag}`, and nothing said why.

Source: `/docs/routing`, "What is refused".
