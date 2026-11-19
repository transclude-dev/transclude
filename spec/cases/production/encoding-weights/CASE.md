A response goes out in the encoding the client weighs highest, read as RFC
9110 writes `Accept-Encoding`:

- A parameter name ignores case, so `br;Q=0` refuses brotli.
- `x-gzip` is `gzip`.
- A client that weighs no encoding above every coding gets the body as it is:
  `gzip;q=0.5, identity` and `identity, br;q=0.5`.
- An identity the header never names outranks nothing: `br;q=0.8` is brotli.
- A weight outside the grammar is a refusal: `br;q=.5`, `br;q=1.5` and
  `br;q=0.5x` each leave `gzip`.
- A coding named twice keeps the lower weight, so `gzip, gzip;q=0` and
  `gzip;q=0, gzip` each refuse it.

Source: `types/api/negotiate.d.ts`, which says the rules are followed
properly, and RFC 9110, section 12.5.3. The drill in `spec/DRILLS.md` found
these.
