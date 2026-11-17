A handler that returns anything but a `Response` throws and says so: the
request answers 500, and the log names the verb and what it returned.

Source: `/docs/endpoints`, the note "A handler has to return one".
