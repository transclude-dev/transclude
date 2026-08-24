// A new run. The one URL here that is not idempotent, on purpose: it mints a
// seed, sends you to the first room, and is never a page anybody bookmarks.
//
// An endpoint rather than a page, because minting anything inside a loader would
// make a page that renders differently every time it is read. The URL it
// redirects to is the save file, and that one is stable forever.

import { START } from '../data/rooms.js';
import { mint } from '../lib/rng.js';

export const GET = ({ url }) => {
  const seed = mint();
  const next = `/dungeon/${START}?seen=${START}&seed=${seed}`;

  // 303, so the browser's back button steps over this and lands on the page
  // before it rather than minting a second run.
  return new Response(null, { status: 303, headers: { Location: next } });
};
