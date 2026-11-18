A signed cookie whose value or signature was changed reads as `undefined`,
the same as a missing one, so `?? 'guest'` gives the fallback and never the
forged value. The forgeries: no signature, a made-up one, and the real
signature for `ada` under the value `eve`.

Source: `/docs/cookies`, "A forged cookie is not a missing one".
