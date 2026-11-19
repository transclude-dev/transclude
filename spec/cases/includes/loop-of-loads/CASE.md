A loop of route loads is refused, and the error names the way round. Loading
a route resolves every include on it, so a loop can come back by another
fragment: `/y#a` reaches `/z#c`, which reaches `/y#d`. Each `src` is new, and
the old module waited on its own load, so the request never answered. `/both`
starts `/y` and `/z` together, and each finds the other's load already
running. Not prerendered, so the answer is a 500 at request time.

Source: `/docs/includes`, "What is refused". The include drill found it
(`spec/DRILLS.md`).
