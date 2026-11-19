A `<pre>` or a `<textarea>` keeps a newline its content begins with, written in
the page or interpolated. A browser drops the first newline after either start
tag, so the server writes one for it to drop.

Source: the gotcha "A `<pre>` or a `<textarea>` lost the newline its content
began with". The `escaping` property in `security/escaping-generated` found it.
