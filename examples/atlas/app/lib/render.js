// The field registry. This is the product.
//
// There is no renderer per record type here and there must not be one. A record
// arrives with a lexicon that says what each field is, and this file turns the
// pair into a flat list of fields the templates can print. A record type nobody
// has seen before renders properly the first time, because nothing here knows
// what a post is.
//
// Flat, with a `depth` on each field, rather than a tree. A tree would mean a
// template that includes itself, and an element that renders itself is a good
// way to find out what the compiler does about cycles. Indentation is a CSS
// problem, and this is the whole reason the shape is a list.
//
// Nothing here builds HTML. Every field comes out as data, and the templates in
// `elements/` decide what it looks like.

import { defIn, localDef } from './lexicon.js';

/**
 * @typedef {object} Field
 * @property {string} name  The property name, as the record spells it.
 * @property {string} kind  Which template branch renders it.
 * @property {string} text  What to print.
 * @property {string|null} href  Where it links, if anywhere.
 * @property {number} depth  0 for a top-level field.
 * @property {boolean} required  Whether the lexicon demands it.
 * @property {string|null} description  The lexicon's own words for this field.
 * @property {Record<string, any>} meta  Anything the template needs beyond text.
 * @property {string[]} items  Inline values, for a list of scalars.
 */

/** How deep a nested object is followed before it is left as raw JSON. */
const MAX_DEPTH = 3;

/** How much of a field a listing row shows. */
const SUMMARY_LENGTH = 200;

/**
 * The one line that stands for a record in a listing.
 *
 * The lexicon decides this too. Prose beats plain text, because a field with a
 * grapheme limit is something somebody typed, and the first one of those is
 * almost always the thing the record is about. Nothing here knows the word
 * "post" or the word "text".
 *
 * @param {Field[]} fields
 * @returns {string}
 */
export function summaryOf(fields) {
  const found = fields.find((field) => field.kind === 'prose') ?? fields.find((field) => field.kind === 'text');
  if (!found) return '';
  const text = found.text.replace(/\s+/g, ' ').trim();
  return text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH)}...` : text;
}

/**
 * When a record says it was made. The first datetime field, whatever it is
 * called, because `createdAt` is a convention and not a rule.
 *
 * @param {Field[]} fields
 * @returns {string|null}
 */
export const whenOf = (fields) => fields.find((field) => field.kind === 'datetime')?.meta.datetime ?? null;

/**
 * @typedef {object} Ctx
 * @property {string} did  Whose repository this record is in. Addresses blobs.
 * @property {string} pds  Which server holds it.
 * @property {object|null} [own]  The record's own lexicon, for its local refs.
 * @property {Record<string, object>} [lexicons]  Every other lexicon in hand, by NSID.
 */

/**
 * Every field of a record, in the lexicon's order where there is one.
 *
 * @param {Record<string, any>} value  The record.
 * @param {object|null} def  `defs.main.record` from the lexicon, or null.
 * @param {Ctx} ctx
 * @returns {Field[]}
 */
export function fieldsOf(value, def, ctx) {
  if (!value || typeof value !== 'object') return [];

  /** @type {Field[]} */
  const out = [];
  const properties = def?.properties ?? {};
  const required = new Set(def?.required ?? []);

  // The lexicon's order first, because it is the order somebody chose. Anything
  // the record carries that the lexicon does not mention follows, and is marked:
  // an extra field is either an extension or a mistake, and both are worth
  // seeing.
  const named = Object.keys(properties).filter((key) => value[key] !== undefined);
  const extra = Object.keys(value).filter((key) => key !== '$type' && !(key in properties));

  for (const key of named) walk(key, properties[key], value[key], required.has(key), 0, ctx, out);
  for (const key of extra) walk(key, null, value[key], false, 0, ctx, out);

  return out;
}

/**
 * One value, appended to `out` along with anything nested inside it.
 *
 * Read this as a list of cases, not as an algorithm. Each `if` is one row of
 * the table in the README, and they are in the order a reader would look for
 * them: the containers first, then the shapes, then the string formats.
 */
function walk(name, rawDef, value, required, depth, ctx, out) {
  const def = effective(rawDef, value, ctx);

  const base = {
    name,
    depth,
    required,
    description: def?.description ?? null,
    href: null,
    items: [],
    meta: {},
  };

  const push = (rest) => out.push({ ...base, ...rest });

  if (value === null) return push({ kind: 'null', text: 'null' });

  // ---- containers ---------------------------------------------------------

  if (Array.isArray(value)) return array(name, def, value, required, depth, ctx, out, push);

  if (isBlob(value)) return push(blob(value, ctx));

  if (isCidLink(value)) return push({ kind: 'cid', text: value.$link, meta: { copy: value.$link } });

  if (isBytes(value)) return push({ kind: 'bytes', text: `${byteLength(value.$bytes)} bytes` });

  if (typeof value === 'object') return object(name, def, value, required, depth, ctx, out, push);

  // ---- scalars ------------------------------------------------------------

  if (typeof value === 'boolean') return push({ kind: 'boolean', text: value ? 'true' : 'false' });
  if (typeof value === 'number') return push({ kind: 'number', text: String(value) });

  return string(String(value), def, push);
}

/**
 * The def that actually describes a value.
 *
 * A lexicon rarely says what a field is in the same place it names it. `reply`
 * is a `ref` to `#replyRef`, whose `root` is a `ref` to
 * `com.atproto.repo.strongRef`, whose `uri` is finally a string with a format.
 * Without following those, a post's reply renders as four fields nothing
 * describes, and the page says "unknown" about values it could have named.
 *
 * Three sources, in order. A value that carries its own `$type` beats the
 * schema, because a union says what was allowed and the value says what it is.
 */
function effective(def, value, ctx) {
  const type = typeof value?.$type === 'string' ? value.$type : null;
  if (type) {
    const found = ctx.lexicons?.[type.split('#')[0]];
    if (found) return defIn(found, type) ?? def;
  }

  const ref = typeof def?.ref === 'string' ? def.ref : null;
  if (!ref) return def;

  // A local ref costs nothing: the def is in the document already in hand.
  if (ref.startsWith('#')) return localDef(ref, ctx.own) ?? def;

  const found = ctx.lexicons?.[ref.split('#')[0]];
  return found ? defIn(found, ref) ?? def : def;
}

// ---- containers -----------------------------------------------------------

function array(name, def, value, required, depth, ctx, out, push) {
  const items = def?.items ?? null;
  const scalars = value.every((entry) => entry === null || typeof entry !== 'object');

  // A list of strings is a row of chips, not four rows of a table. This is the
  // one place the shape of the data changes how it is laid out, and it is worth
  // it: `langs` and `tags` are unreadable one per line.
  if (scalars) {
    return push({
      kind: 'list',
      text: `${value.length} item${value.length === 1 ? '' : 's'}`,
      items: value.map((entry) => label(String(entry), items)),
      meta: { count: value.length },
    });
  }

  push({ kind: 'group', text: `${value.length} item${value.length === 1 ? '' : 's'}`, meta: { count: value.length } });

  if (depth >= MAX_DEPTH) return;
  value.forEach((entry, index) => walk(String(index), items, entry, false, depth + 1, ctx, out));
}

function object(name, def, value, required, depth, ctx, out, push) {
  // A value carries its own type when it came from a union, and that is a
  // better answer than the lexicon's, which only lists what was allowed.
  const type = typeof value.$type === 'string' ? value.$type : null;

  if (depth >= MAX_DEPTH) {
    return push({ kind: 'raw', text: JSON.stringify(value, null, 2), meta: { type } });
  }

  push({
    kind: 'group',
    text: type ?? 'object',
    href: type ? `/lexicon/${type.split('#')[0]}` : null,
    meta: { type },
  });

  const properties = def?.properties ?? {};
  const inner = new Set(def?.required ?? []);

  for (const [key, entry] of Object.entries(value)) {
    if (key === '$type') continue;
    walk(key, properties[key] ?? null, entry, inner.has(key), depth + 1, ctx, out);
  }
}

// ---- strings --------------------------------------------------------------

/**
 * A string, by the format its lexicon gave it. Without a lexicon every string is
 * text, which is the honest answer rather than a guess: `did:plc:abc` in an
 * unschema'd field might be a DID, and might be somebody's display name.
 */
function string(value, def, push) {
  const format = def?.format ?? null;

  if (format === 'at-uri') {
    return push({ kind: 'at-uri', text: value, href: `/at/${value.replace(/^at:\/\//, '')}` });
  }

  if (format === 'did') return push({ kind: 'did', text: value, href: `/did/${value}` });
  if (format === 'handle') return push({ kind: 'handle', text: value, href: `/at/${value}` });
  if (format === 'nsid') return push({ kind: 'nsid', text: value, href: `/lexicon/${value}` });
  if (format === 'cid') return push({ kind: 'cid', text: value });

  if (format === 'datetime') {
    // Absolute, in UTC, and never relative. This page is cached, so "2 minutes
    // ago" would be wrong for everybody who read the cached copy.
    const parsed = new Date(value);
    const valid = !Number.isNaN(parsed.getTime());
    return push({
      kind: 'datetime',
      text: valid ? parsed.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : value,
      meta: { datetime: valid ? parsed.toISOString() : null },
    });
  }

  if (format === 'uri') {
    const host = hostOf(value);
    return push({ kind: 'uri', text: value, href: host ? value : null, meta: { host } });
  }

  if (format === 'language') {
    return push({ kind: 'language', text: value, meta: { name: languageName(value) } });
  }

  // A field with a grapheme limit is prose somebody typed, and the limit is
  // part of what the schema says about it.
  if (def?.maxGraphemes) {
    const used = graphemes(value);
    return push({
      kind: 'prose',
      text: value,
      meta: { graphemes: used, maxGraphemes: def.maxGraphemes, ratio: used / def.maxGraphemes },
    });
  }

  if (!def) return push({ kind: 'unknown', text: value });

  return push({ kind: 'text', text: value });
}

/** A scalar inside an inline list, with its format applied to the label only. */
function label(value, def) {
  if (def?.format === 'language') return `${value} · ${languageName(value) ?? 'unknown'}`;
  return value;
}

// ---- shapes ---------------------------------------------------------------

const isBlob = (value) =>
  value?.$type === 'blob' || (value?.ref?.$link !== undefined && value?.mimeType !== undefined);

const isCidLink = (value) => typeof value?.$link === 'string' && Object.keys(value).length === 1;

const isBytes = (value) => typeof value?.$bytes === 'string' && Object.keys(value).length === 1;

/**
 * A blob is addressed on the PDS that holds it, and this app links there rather
 * than serving a copy. Proxying somebody else's media through this domain would
 * put their content behind this app's name, which is a thing to take on
 * deliberately and not by accident.
 */
function blob(value, ctx) {
  const cid = value?.ref?.$link ?? value?.cid ?? null;
  const mime = value?.mimeType ?? 'application/octet-stream';
  const size = Number(value?.size ?? 0);
  const href = cid ? `${ctx.pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(ctx.did)}&cid=${cid}` : null;

  return {
    kind: mime.startsWith('image/') ? 'image' : 'blob',
    text: `${mime} · ${kb(size)}`,
    href,
    meta: { mime, size, cid },
  };
}

// ---- small helpers --------------------------------------------------------

const kb = (bytes) => (bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`);

const byteLength = (base64) => Math.floor((String(base64).length * 3) / 4);

function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/** `en` becomes English. Every runtime here has Intl, so nothing is bundled. */
function languageName(tag) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? null;
  } catch {
    return null;
  }
}

/**
 * What the lexicon means by a grapheme: a user-perceived character, so an emoji
 * with a skin tone counts once and not four times. `length` would count units.
 */
function graphemes(value) {
  try {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return [...segmenter.segment(value)].length;
  } catch {
    return value.length;
  }
}
