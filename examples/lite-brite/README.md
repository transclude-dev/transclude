# Lite-Brite

A [Lite-Brite](https://en.wikipedia.org/wiki/Lite-Brite) that fits the screen
with nothing to scroll. Pick a colour, tap a hole, and a peg lights up. Pick
Pull and tap it again to take the peg out. Two hundred and forty holes, ten
colours, and zero bytes of JavaScript.

```sh
npm install
npm run dev     # http://localhost:1972
```

## What to look at

`app/routes/index.html` is the whole app. A `<script server>` block names the
grid and the colours, the markup under it is the board, and the style block at
the bottom draws it.

**A hole is a radio group.** Eleven radios share the name `p137`: one `off`,
checked to begin with, and one per colour. A radio group holds exactly one value,
and the browser is the thing that holds it. So the board's state is form state,
and nothing on the server or in a database knows what anyone drew.

**Eleven labels are stacked over each hole, and ten of them are inert.** Every
radio has a label filling the whole cell. `.hole` sets `pointer-events: none`, so
none of them is a target until a rule says otherwise:

```css
.brite:has(#ink-blue:checked) .hole > label.blue { pointer-events: auto; }
```

The tray decides which layer takes the tap. That is the whole mechanic: a tap
lands on the label for the colour in hand, and checks the radio it points at.

**Rendering reads the checked radio.** One rule per colour, and this is all of
it:

```css
.hole:has(input.red:checked) { --peg: var(--red); --lit: 1; }
```

`.hole::before` is the empty socket. `.hole::after` is the peg, a highlight over
`var(--peg)` with a `box-shadow` bloom, revealed by `opacity: var(--lit, 0)`.

**No swatch carries `checked`.** So one rule covers two states:

```css
.brite:not(:has(.pick:checked)) .hole > label.red { pointer-events: auto; }
```

Red is in hand at first paint, and red is in hand again after the board is
emptied, because a reset puts the tray back to nothing checked.

**Emptying the board is `<input type="reset">`.** A reset button returns every
control in the form to the value its markup declared, which for 2,651 radios is
`off`. The browser already had a button for this.

**One number sizes everything.** `--cell` is the smaller of the width left over
after the frame and the height left over after the tray, so the board fits the
viewport both ways with nothing to scroll. `--cols` and `--rows` arrive as inline
custom properties from the server data, which is how CSS gets to divide by them.

**The tray comes first in the markup.** Two hundred and forty holes are two
hundred and forty tab stops, so a tray after them would be unreachable from the
keyboard. `grid-row` puts it back under the board. Arrow keys work inside a hole
too: focus one and the peg cycles through the colours.

## The size of the board

`COLS` and `ROWS` at the top of the page decide the markup, the tap target and
the response, and they pull against each other. The board fills the viewport, so
a hole is as wide as the screen divided by the columns, and a finger wants about
20 of those pixels.

| Board | Holes | Raw | gzip | brotli | Hole at 390px | at 320px |
| --- | --- | --- | --- | --- | --- | --- |
| 20 × 12 | 240 | 383 KB | 24 KB | 11 KB | 17px | 14px |
| 24 × 14 | 336 | 533 KB | 32 KB | 16 KB | 15px | 12px |
| 30 × 17 | 510 | 804 KB | 45 KB | 20 KB | 12px | 10px |

20 × 12 ships here. 30 × 17 is closer to the real toy and misses under a finger.
The page compresses to about 3% of itself, because 240 holes are 240 copies of
the same 23 tags, so the cost of a bigger board is the parse rather than the
download: 30 × 17 is 11,800 elements and 5,600 radio buttons.

A cap of `2.5rem` on `--cell` stops the board from filling a monitor. It sits in
the dark at about the size of the real one instead.

## What it leaves out

**Dragging to paint.** A drag is a pointer event, and reading one needs a script.
This page has none, so the board is tap by tap.

**Saving, sharing and undo.** The drawing lives in the form, which means it lives
in the tab. A reload is a blank board. Undo would be a history, and a history
needs somewhere to keep it.

**A colour picker.** Ten colours are ten radios and four rules each. An arbitrary
colour is an `<input type="color">` whose value only CSS could read, and CSS
cannot read a form value.

## Tests

```sh
npm run build && npm test
```

They read the built page and check the two halves agree: every label points at a
radio that exists, every colour in the server block has the four rules the
mechanic needs, and nothing in the output is a script. What a browser does with
those bytes is CSS, and Node models none of it.
