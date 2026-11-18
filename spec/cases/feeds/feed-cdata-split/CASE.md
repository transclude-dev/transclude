A feed item's HTML goes in a CDATA section. `]]>` in it is split across two
sections, so a reader puts the three characters back together.

Source: `design/internals.md`, "`]]>` has to be split, and it turns up in ordinary code."
