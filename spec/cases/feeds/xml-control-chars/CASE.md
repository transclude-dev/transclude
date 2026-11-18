XML 1.0 cannot carry a C0 control character. One in a feed field or a sitemap
field is dropped, so the document still parses. Tab, newline and return are
kept.

Source: `design/internals.md`, "XML 1.0 cannot carry a C0 control, so one has to be dropped before it is written."
