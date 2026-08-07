-- The subscriber list.
--
--   wrangler d1 execute transclude-subscribers --remote --file schema.sql
--
-- This table is the record of who asked and when, not a copy of a mailing list.
-- Whatever sends the mail owns "do they still want it", and unsubscribes belong
-- there. What lives here is the consent trail: the address, when it arrived,
-- which page it came from, and whether the person proved they own the inbox.
--
-- Written before the address is confirmed, on purpose. The alternative is
-- holding a pending signup in memory between two requests, which loses it when
-- the isolate goes.

CREATE TABLE IF NOT EXISTS subscribers (
  email        TEXT PRIMARY KEY,

  -- `pending` until the token comes back, then `confirmed`. Nothing is mailed
  -- to a pending address except the one message asking it to confirm.
  status       TEXT NOT NULL DEFAULT 'pending',

  -- What the confirmation link carries. Random per signup, so a second signup
  -- for the same address issues a new one and the old link stops working.
  token        TEXT NOT NULL,

  -- Which page the form was on. A signup from a post is a different intent from
  -- one on the landing page, and knowing the difference is free at write time
  -- and impossible to reconstruct later.
  source       TEXT,

  created_at   INTEGER NOT NULL,
  confirmed_at INTEGER
);

-- The confirm route looks a signup up by token and nothing else, so this is the
-- one index that is not the primary key.
CREATE INDEX IF NOT EXISTS subscribers_token ON subscribers (token);


-- What has been sent, so it cannot be sent twice.
--
-- A retry, a fat-fingered command, a queue redelivery. Everything else in this
-- system is recoverable by hand; posting issue three to the list a second time
-- is the one a subscriber sees, and there is no taking it back.
--
-- Keyed on the issue rather than on a timestamp, so the check is `does a row
-- exist` rather than arithmetic on when the last one went.
CREATE TABLE IF NOT EXISTS sends (
  issue        TEXT PRIMARY KEY,

  -- What the provider filed it under, for looking up what happened afterwards.
  broadcast_id TEXT,

  -- How many addresses it went to when it went, which is the number that stops
  -- meaning anything the moment anyone else subscribes.
  recipients   INTEGER,

  sent_at      INTEGER NOT NULL
);
