On an action request the guards run first, each reading what the one above it
returned as `ctx.layout`. The inner guard lets the request through only when
the outer one said `admin`, so the `POST` reaches the handler and the count
after it is 1.

Source: `/docs/layouts`, "Nesting" and "A layout can respond on its own".
