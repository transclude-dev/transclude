A template expression has no arrow function, so one in `if` is refused, with
the file and line.

Source: `/docs/routing`, "Directives".

The message carries the expression parser's own words, "Expected comma at
character 15". Joe chose to keep them in the contract, so a rewrite with
another parser has to say the same.
