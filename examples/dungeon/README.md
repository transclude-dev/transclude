# Dungeon

A dungeon crawl whose save file is the address bar. Fifteen rooms, three things
to carry, two ways out, and no client JavaScript.

```sh
npm install
npm run dev     # http://localhost:1973
```

Then walk down. A move is a link, and the link already holds everything the next
page needs to know.

## The URL is the whole of it

```
/dungeon/vault?have=brass-key,lantern&seen=gate,hall,vault&seed=7f3a
```

| | |
| --- | --- |
| the path | the room you are standing in |
| `have` | what you are carrying |
| `seen` | where you have been, which is what the minimap draws |
| `seed` | the run, which is what anything random is derived from |

The server keeps nothing. No cookie, no session, no row anywhere. Three things
follow, and they are the reason this demo exists.

**Back is undo.** One move back, every time, because a move is a document
navigation and the previous URL is the previous state.

**A bookmark is a save slot.** So is a link in a message to somebody else. They
get your run, exactly.

**The same URL is the same page, forever.** Reload it and the bytes match. Two
runs holding the same things are on the same URL, character for character,
because `app/lib/state.js` sorts and dedupes every list before it writes one.

## A shut door is not a link

`app/lib/graph.js` answers what the ways out of a room are, and every exit comes
back either passable or shut. A passable one is rendered as an `<a>`. A shut one
is rendered as text, with the reason:

```html
<span class="shut">
  <b>Down</b>
  The stair goes down into black. Without a light you would be walking blind.
</span>
```

There is no request to refuse, because there is no link to click. The lock reads
`have`, so a URL with `have=brass-key` typed in by hand opens the iron door
without ever having visited the vault. That is not a hole. The URL is the save
file, and a hand-edited save is a cheat rather than an error.

## The map checks itself

`check` in `graph.js` runs when the module is first imported, which is when the
app starts. An exit to a room that is not there, a lock naming an item that is
not there, two rooms in one cell on the minimap, an item nobody put anywhere: the
dev server stops and the build stops, naming the room and the exit.

The reachability walk collects items as it goes, which is the part worth copying.
A walk that ignores locks says a map with the key inside the room it opens is
fine.

## What the framework does here

**`export const prerender = false` on `dungeon/[room].html` is load-bearing.**
The static handler keys on the path alone, so a file written at build time would
answer every run with whatever state the build had, which is none.

**`/dungeon` is an endpoint, not a page.** It mints a seed, redirects to the
first room with a 303, and is the only URL here that answers differently twice.
Minting inside a loader would make a page that reads differently every time it is
opened.

**The room panel is a URL of its own.** `?fragment=room` returns the panel and
nothing else, out of the same compiled markup the whole page is made of:

```sh
curl 'localhost:1973/dungeon/gate?seen=gate&seed=7f3a&fragment=room'
```

A test asserts the answer is a substring of the page it came from. Nothing here
swaps one in, and nothing should: this framework ships no swapper, and the ones
that exist navigate an iframe or a history entry of their own. The address bar is
the save file, so anything that stops writing to it takes the save file away.

**Two enhancements, neither of them code we wrote.** `@view-transition` animates
room to room, and `speculate: true` puts a `<script type="speculationrules">`
block on every page so the room behind a link is fetched while you are still
deciding. The browser reads both as data. The build puts every room in
`prefetch` and none in `prerender`, which is the right split twice over: a room
is a server render, and `/dungeon` is an endpoint, so hovering the way in never
spends a seed.

## Randomness a URL can carry

Nothing is sampled while a page renders. The cellar reads one of three lines,
and which one is derived:

```js
roll(seed, roomId, eventKey, n);
```

Same URL, same line. That is what makes the back button an undo rather than a
reroll, and it is why `test/portable.test.js` refuses `Math.random()` and
`Date.now()` anywhere in `app/` except the entry endpoint's seed.

## What it leaves out

**Combat, hit points, a bag with a limit, and anybody to talk to.** Each one is a
number that would have to live in the URL, and the demo is about the URL rather
than about the game.

**A server that remembers you.** That is the thing being argued with.

**Swapping the panel in place.** Covered above. The fragment is real and has a
test; what is missing is a swapper, on purpose.

## Tests

```sh
npm run build && npm test
```

`test/graph.test.js` hands the checks a broken map, one break at a time, and
asserts what they say about it. `test/state.test.js` holds the canonical form.
`test/app.test.js` walks two whole runs through the built app, following only
links the page it is standing on actually rendered, and reads the bytes a browser
gets. `test/portable.test.js` keeps one runtime's name out of the request path.

The same build answers identically on Node, Bun, Deno and workerd:

```sh
npm start                                                    # Node
bun node_modules/@transclude/core/bin/serve.bun.js           # Bun
deno run -A node_modules/@transclude/core/bin/serve.deno.js  # Deno
npx wrangler dev                                             # workerd
```
