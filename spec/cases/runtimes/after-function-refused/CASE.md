`ctx.after` takes the promise, not a function that makes one. A function is
refused rather than wrapped, because wrapping it would run nothing.

Source: `/docs/runtimes`, "Work after the response".
