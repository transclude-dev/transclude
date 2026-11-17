A module-level `Response` works for the first request. Every request after it
answers 500, because its body is already read.

Source: `/docs/forms`, the note "Build a Response in a function, never share
one".
