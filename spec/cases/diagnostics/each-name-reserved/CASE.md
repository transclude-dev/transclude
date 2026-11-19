A loop name cannot be a reserved word, so `each="class of classes"` is
refused, with the file and line. The server could render it, because the
compiler renames each loop name, but the type check would report a syntax
error on a line the author never wrote.

Source: `/docs/routing`, "What is refused".
