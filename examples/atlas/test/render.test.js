// The field registry.
//
// The record type below does not exist. That is the point: nothing in
// `render.js` knows what a post is, so a lexicon invented for this file has to
// render as well as a real one. If these pass and the live pages look wrong,
// the fault is in the templates rather than here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fieldsOf, summaryOf, whenOf } from '../app/lib/render.js';

const CTX = { did: 'did:plc:ada', pds: 'https://pds.example' };

/** One lexicon, exercising every row of the registry. */
const LEXICON = {
  nsid: 'example.atlas.test.thing',
  schema: {
    id: 'example.atlas.test.thing',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: ['note'],
          properties: {
            note: { type: 'string', maxGraphemes: 20, description: 'What it says.' },
            plain: { type: 'string' },
            when: { type: 'string', format: 'datetime' },
            about: { type: 'string', format: 'at-uri' },
            who: { type: 'string', format: 'did' },
            named: { type: 'string', format: 'handle' },
            site: { type: 'string', format: 'uri' },
            langs: { type: 'array', items: { type: 'string', format: 'language' } },
            count: { type: 'integer' },
            live: { type: 'boolean' },
            picture: { type: 'blob', accept: ['image/*'] },
            archive: { type: 'blob' },
            proof: { type: 'cid-link' },
            payload: { type: 'bytes' },
            inner: { type: 'ref', ref: '#detail' },
            others: { type: 'array', items: { type: 'ref', ref: '#detail' } },
          },
        },
      },
      detail: {
        type: 'object',
        required: ['label'],
        properties: {
          label: { type: 'string' },
          at: { type: 'string', format: 'at-uri' },
        },
      },
    },
  },
};

const DEF = LEXICON.schema.defs.main.record;
const ctx = { ...CTX, own: LEXICON, lexicons: {} };

const by = (fields, name) => fields.find((field) => field.name === name);

// ---- one field per row of the registry ------------------------------------

test('a string with a grapheme limit is prose, and carries its meter', () => {
  const [field] = fieldsOf({ note: 'hello 👍🏽' }, DEF, ctx);

  assert.equal(field.kind, 'prose');
  assert.equal(field.text, 'hello 👍🏽');
  assert.equal(field.required, true);
  assert.equal(field.description, 'What it says.');
  // A skin-toned emoji is one grapheme and four code units. The limit the
  // lexicon set is in graphemes, so the meter has to agree with the lexicon.
  assert.equal(field.meta.graphemes, 7);
  assert.equal(field.meta.maxGraphemes, 20);
});

test('each string format becomes its own kind and its own link', () => {
  const fields = fieldsOf(
    {
      plain: 'just text',
      when: '2026-08-06T12:30:00.000Z',
      about: 'at://did:plc:bob/example.atlas.test.thing/abc',
      who: 'did:plc:bob',
      named: 'ada.example',
      site: 'https://example.com/page',
      langs: ['en', 'ja'],
    },
    DEF,
    ctx,
  );

  assert.equal(by(fields, 'plain').kind, 'text');

  assert.equal(by(fields, 'when').kind, 'datetime');
  assert.equal(by(fields, 'when').meta.datetime, '2026-08-06T12:30:00.000Z');

  assert.equal(by(fields, 'about').kind, 'at-uri');
  assert.equal(by(fields, 'about').href, '/at/did:plc:bob/example.atlas.test.thing/abc');

  assert.equal(by(fields, 'who').href, '/did/did:plc:bob');
  assert.equal(by(fields, 'named').href, '/at/ada.example');

  assert.equal(by(fields, 'site').kind, 'uri');
  assert.equal(by(fields, 'site').meta.host, 'example.com');

  // A list of scalars stays inline, and the format still reaches each entry.
  assert.equal(by(fields, 'langs').kind, 'list');
  assert.deepEqual(by(fields, 'langs').items, ['en · English', 'ja · Japanese']);
});

test('numbers, booleans and nulls each say what they are', () => {
  const fields = fieldsOf({ count: 3, live: false, plain: null }, DEF, ctx);

  assert.equal(by(fields, 'count').kind, 'number');
  assert.equal(by(fields, 'live').text, 'false');
  assert.equal(by(fields, 'plain').kind, 'null');
});

test('a blob is addressed on the server that holds it', () => {
  const picture = { $type: 'blob', ref: { $link: 'bafkreiabc' }, mimeType: 'image/jpeg', size: 4096 };
  const [field] = fieldsOf({ picture }, DEF, ctx);

  assert.equal(field.kind, 'image');
  assert.equal(field.text, 'image/jpeg · 4 KB');
  // Linked to the PDS, not proxied through this app. Serving somebody else's
  // media from this domain is a decision, not a side effect.
  assert.equal(
    field.href,
    'https://pds.example/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aada&cid=bafkreiabc',
  );
});

test('a blob that is not an image is a link and a size', () => {
  const archive = { $type: 'blob', ref: { $link: 'bafkreixyz' }, mimeType: 'application/zip', size: 900 };
  const [field] = fieldsOf({ archive }, DEF, ctx);

  assert.equal(field.kind, 'blob');
  assert.equal(field.text, 'application/zip · 900 bytes');
});

test('a cid-link and a bytes value are told apart from an object', () => {
  const fields = fieldsOf({ proof: { $link: 'bafyabc' }, payload: { $bytes: 'aGVsbG8=' } }, DEF, ctx);

  assert.equal(by(fields, 'proof').kind, 'cid');
  assert.equal(by(fields, 'proof').text, 'bafyabc');
  assert.equal(by(fields, 'payload').kind, 'bytes');
});

// ---- nesting --------------------------------------------------------------

test('a local ref is followed, so its fields keep their formats', () => {
  // Without following `#detail`, `at` below is a string nothing describes and
  // renders as unknown rather than as a link.
  const fields = fieldsOf({ inner: { label: 'one', at: 'at://did:plc:bob/x.y.z/1' } }, DEF, ctx);

  assert.deepEqual(fields.map((field) => [field.name, field.depth]), [
    ['inner', 0],
    ['label', 1],
    ['at', 1],
  ]);
  assert.equal(by(fields, 'at').kind, 'at-uri');
  assert.equal(by(fields, 'label').required, true);
});

test('a value naming its own type beats the schema that allowed it', () => {
  const lexicons = {
    'example.atlas.other': {
      nsid: 'example.atlas.other',
      schema: { defs: { main: { type: 'object', properties: { link: { type: 'string', format: 'did' } } } } },
    },
  };

  const fields = fieldsOf(
    { inner: { $type: 'example.atlas.other', link: 'did:plc:bob' } },
    DEF,
    { ...ctx, lexicons },
  );

  assert.equal(by(fields, 'inner').href, '/lexicon/example.atlas.other');
  assert.equal(by(fields, 'link').kind, 'did');
});

test('an array of objects becomes a group and then its items', () => {
  const fields = fieldsOf({ others: [{ label: 'a' }, { label: 'b' }] }, DEF, ctx);

  assert.equal(fields[0].kind, 'group');
  assert.equal(fields[0].meta.count, 2);
  assert.deepEqual(fields.slice(1).map((field) => [field.name, field.depth]), [
    ['0', 1],
    ['label', 2],
    ['1', 1],
    ['label', 2],
  ]);
});

// ---- no lexicon at all ----------------------------------------------------

test('a record nobody published a schema for still renders, field by field', () => {
  const fields = fieldsOf(
    { title: 'Untitled', votes: 4, tags: ['x', 'y'], meta: { deep: true } },
    null,
    { ...CTX, own: null, lexicons: {} },
  );

  // Every value is shown. The strings are marked as unschema'd rather than
  // guessed at: `did:plc:abc` in a field nothing described might be a DID, and
  // might be somebody's display name.
  assert.equal(by(fields, 'title').kind, 'unknown');
  assert.equal(by(fields, 'votes').kind, 'number');
  assert.equal(by(fields, 'tags').kind, 'list');
  assert.equal(by(fields, 'meta').kind, 'group');
  assert.equal(by(fields, 'deep').text, 'true');
});

test('a field the lexicon never mentioned is kept, and comes last', () => {
  const fields = fieldsOf({ surprise: 'hello', note: 'described' }, DEF, ctx);

  // An extra field is either an extension or a mistake, and both are worth
  // seeing. Dropping it would make the page disagree with the raw JSON below it.
  assert.deepEqual(fields.map((field) => field.name), ['note', 'surprise']);
  assert.equal(by(fields, 'surprise').kind, 'unknown');
});

test('$type on the record itself is not rendered as a field', () => {
  const fields = fieldsOf({ $type: 'example.atlas.test.thing', plain: 'x' }, DEF, ctx);

  assert.deepEqual(fields.map((field) => field.name), ['plain']);
});

// ---- what stands for a record in a listing --------------------------------

test('the summary is the first prose field, whatever it is called', () => {
  const fields = fieldsOf({ plain: 'second', note: 'first' }, DEF, ctx);

  // `plain` comes first in the record and `note` is the one with a grapheme
  // limit, so `note` is what somebody typed. Nothing here knows either name.
  assert.equal(summaryOf(fields), 'first');
});

test('the summary falls back to plain text, and is cut to one line', () => {
  const long = 'x'.repeat(400);
  const fields = fieldsOf({ plain: long }, DEF, ctx);

  assert.equal(summaryOf(fields).length, 203);
  assert.equal(summaryOf(fields).endsWith('...'), true);
});

test('the date is the first datetime field, and empty when there is none', () => {
  assert.equal(whenOf(fieldsOf({ when: '2026-08-06T00:00:00.000Z' }, DEF, ctx)), '2026-08-06T00:00:00.000Z');
  assert.equal(whenOf(fieldsOf({ plain: 'x' }, DEF, ctx)), null);
});
