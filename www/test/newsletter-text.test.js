// The plain-text half, derived from the markup that is going out.
//
// What is worth testing is not that it produces text, but which text it leaves
// out and which it rearranges: a hidden preheader, a link that has to carry its
// own destination, and table markup that means nothing to a reader.

import test from 'node:test';
import assert from 'node:assert/strict';

import { textFrom } from '../scripts/newsletter-text.js';

test('a paragraph is its words', () => {
  assert.equal(textFrom('<p>Hello there</p>'), 'Hello there');
});

test('blocks are separated, and the indentation of the source is not', () => {
  // The markup is written to be read as source, so every line of it arrives
  // wrapped and indented. None of that is meaning.
  const html = `
    <p>
      One sentence
      split across lines.
    </p>
    <p>Another.</p>
  `;

  assert.equal(textFrom(html), 'One sentence split across lines.\n\nAnother.');
});

test('a link carries where it goes, because text cannot', () => {
  assert.equal(
    textFrom('<p><a href="https://example.dev/post">Read it</a></p>'),
    'Read it (https://example.dev/post)',
  );
});

test('a bare URL is not written twice', () => {
  const url = 'https://example.dev/post';
  assert.equal(textFrom(`<p><a href="${url}">${url}</a></p>`), url);
});

test('a hidden preheader is left out', () => {
  // It exists for the inbox to show beside the subject, and a reader who opens
  // the message never sees it. In the text it would be the first line, said
  // again immediately.
  const html = `
    <div style="display:none;max-height:0">The preview line</div>
    <p>The actual opening.</p>
  `;

  const text = textFrom(html);
  assert.doesNotMatch(text, /preview line/);
  assert.equal(text, 'The actual opening.');
});

test('style and script contents are not words', () => {
  const html = '<style>.a{color:red}</style><p>Words</p><script>var x = 1;<\/script>';
  assert.equal(textFrom(html), 'Words');
});

test('table markup disappears and its contents do not', () => {
  // The whole message is tables inside tables. None of that is readable and
  // all of the words are.
  const html = `
    <table role="presentation"><tr><td>
      <table><tr><td><p>Inside two tables</p></td></tr></table>
    </td></tr></table>
  `;

  assert.equal(textFrom(html), 'Inside two tables');
});

test('a provider token survives, because the provider fills it in', () => {
  // Resend replaces this at send time in the text part as well as the HTML.
  // Escaping or dropping it would send a subscriber a dead unsubscribe line.
  const html = '<p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a></p>';

  assert.equal(textFrom(html), 'Unsubscribe ({{{RESEND_UNSUBSCRIBE_URL}}})');
});

test('entities are characters by the time they are text', () => {
  assert.equal(textFrom('<p>one &middot; two &amp; three</p>'), 'one · two & three');
});
