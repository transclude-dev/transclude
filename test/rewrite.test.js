// Making a foreign document safe to insert, and making its links still work.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize } from 'parse5';

import { absolutize, baseOf, parseSrcset, rewriteCss, sanitize, schemeOf } from '../src/rewrite.js';

const BASE = 'https://source.example/guide/page.html';

const clean = (html, options) => {
  const root = parse(html);
  const removed = sanitize(root, options);
  return { html: serialize(root), removed };
};

const linked = (html, base = BASE) => serialize(absolutize(parse(html), base));

// ---- what does not travel --------------------------------------------------

test('a script is removed, not neutered', () => {
  const { html } = clean('<p>one</p><script>alert(1)</script><p>two</p>');

  assert.doesNotMatch(html, /script|alert/);
  assert.match(html, /<p>one<\/p><p>two<\/p>/);
});

test('frames and plugins go too', () => {
  for (const tag of ['iframe', 'object', 'embed']) {
    const { html } = clean(`<div><${tag}></${tag}></div>`);
    assert.doesNotMatch(html, new RegExp(tag), tag);
  }
});

test('a base element goes, because it would retarget the host page', () => {
  // It does nothing to the fragment. It changes how every relative URL in the
  // document the fragment lands in is resolved.
  const { html } = clean('<base href="https://elsewhere.example/"><p>one</p>');
  assert.doesNotMatch(html, /<base/);
});

test('a link element goes, because it can pull a stylesheet from anywhere', () => {
  const { html } = clean('<link rel="stylesheet" href="https://elsewhere.example/x.css"><p>o</p>');
  assert.doesNotMatch(html, /<link/);
});

test('a style block goes, because its rules are not scoped to the fragment', () => {
  // Same hazard as the link element above. A block of CSS in a fragment applies
  // to the whole document it lands in, so `p { display: none }` from the source
  // would empty the host page.
  const { html } = clean('<style>p{display:none}</style><p>one</p>');

  assert.doesNotMatch(html, /<style|display:none/);
  assert.match(html, /<p>one<\/p>/);
});

test('a style attribute stays by default, because it paints only its element', () => {
  // A highlighted code block carries its colors this way. Dropping them would
  // lose what the source was saying.
  const { html } = clean('<span style="color:#07a">const</span>');
  assert.match(html, /style="color:#07a"/);
});

test("styles: 'strip' takes the attributes and leaves everything else", () => {
  const { html, removed } = clean('<a href="/x" style="color:red" class="k">go</a>', {
    styles: 'strip',
  });

  assert.doesNotMatch(html, /style=/);
  assert.match(html, /href="\/x"/);
  assert.match(html, /class="k"/);
  assert.ok(removed.includes('@style'));
});

test('a meta refresh goes, and an ordinary meta stays', () => {
  const { html } = clean(
    '<meta http-equiv="refresh" content="0;url=https://elsewhere.example/">' +
      '<meta name="description" content="fine">',
  );

  assert.doesNotMatch(html, /refresh/);
  assert.match(html, /name="description"/);
});

test('every event handler attribute is dropped, whatever it is called', () => {
  const { html, removed } = clean('<p onclick="x()" ONMOUSEOVER="y()" onfoo="z()">one</p>');

  assert.doesNotMatch(html, /onclick|onmouseover|onfoo/i);
  assert.match(html, /<p>one<\/p>/);
  assert.equal(removed.filter((r) => r.startsWith('@on')).length, 3);
});

test('a javascript: URL takes its attribute with it', () => {
  // Removed rather than emptied: `href=""` names the page the fragment lands
  // in, and `action=""` submits to it, neither of which the source wrote.
  const { html, removed } = clean(
    '<a href="javascript:alert(1)">x</a><img src="javascript:alert(2)">' +
      '<form action="javascript:alert(3)"></form>',
  );

  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /href=|src=|action=/);
  assert.deepEqual(removed, ['@href', '@src', '@action']);
});

test('a data: URL survives on an image and nowhere else', () => {
  // Ordinary on an image and unable to navigate anything. On an anchor it is a
  // document of the attacker's choosing on this origin.
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const { html } = clean(`<img src="${png}"><a href="data:text/html,<h1>x">y</a>`);

  assert.match(html, new RegExp(png.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /data:text\/html/);
  assert.doesNotMatch(html, /<a href/, 'the refused attribute stayed, emptied');
});

test('the cleaning goes inside a template, because a shadow root is not inert', () => {
  // `<template shadowrootmode>` becomes a real shadow tree in the page that
  // includes it, and a script in there runs. parse5 keeps a template's children
  // on `.content`, so a walk over `childNodes` alone never sees them.
  const { html, removed } = clean(
    '<template shadowrootmode="open"><script>alert(1)</script></template>',
  );

  assert.doesNotMatch(html, /script|alert/);
  assert.deepEqual(removed, ['script']);
});

test('a template inside svg is an ordinary element, and is walked as one', () => {
  // Only an HTML `<template>` keeps its children on `.content`. In `<svg>` the
  // name is an ordinary foreign element, so asking for the tag rather than the
  // field would walk past its real children.
  const { html, removed } = clean('<svg><template><script>alert(1)</script></template></svg>');

  assert.doesNotMatch(html, /script|alert/);
  assert.deepEqual(removed, ['script']);
});

test('an event handler inside a template goes too, at any depth', () => {
  const { html } = clean(
    '<template><div><template><img src="x" onerror="alert(1)"></template></div></template>',
  );

  assert.doesNotMatch(html, /onerror/);
  assert.match(html, /<img src="x">/);
});

test('svg animation goes, because it sets an attribute after this has read it', () => {
  // `<animate attributeName="href" to="javascript:...">` leaves the anchor
  // navigating to a value nothing checked. `values` is a list, so a scheme
  // check would have to read every item of it.
  for (const markup of [
    '<animate attributeName="href" to="javascript:alert(1)"/>',
    '<set attributeName="href" to="javascript:alert(1)"/>',
    '<animate attributeName="href" values="red;javascript:alert(1)"/>',
    '<animateTransform attributeName="transform" to="x"/>',
    '<animateMotion path="M0,0"/>',
  ]) {
    const { html } = clean(`<svg><a href="#x">y</a>${markup}</svg>`);

    assert.doesNotMatch(html, /javascript:|animate|<set/, markup);
    assert.match(html, /<a href="#x">y<\/a>/, markup);
  }
});

test('ordinary content is left alone', () => {
  const source = '<section id="a"><h2>Title</h2><p class="lede">Words.</p><img src="x.png"></section>';
  const { html, removed } = clean(source);

  assert.match(html, /<section id="a">/);
  assert.match(html, /class="lede"/);
  assert.deepEqual(removed, []);
});

// ---- the base --------------------------------------------------------------

test('a base href in the document beats the URL it was fetched from', () => {
  const found = baseOf('<html><head><base href="/root/"></head><body></body></html>', BASE);
  assert.equal(found, 'https://source.example/root/');
});

test('a base is read only where the browser would have honored one', () => {
  // Two places it would not. Template content is inert, so nothing resolves
  // against a base in there, and `<base>` inside `<svg>` is an SVG element of
  // that name which retargets nothing. Either one would otherwise point every
  // relative URL in the document at a host the source never used.
  const inTemplate = '<template><base href="https://elsewhere.example/"></template>';
  const inSvg = '<svg><base href="https://elsewhere.example/"></svg>';

  assert.equal(baseOf(inTemplate, BASE), BASE);
  assert.equal(baseOf(inSvg, BASE), BASE);
});

test('with no base element the response URL is the base', () => {
  assert.equal(baseOf('<p>one</p>', BASE), BASE);
});

test('a relative or protocol-relative base resolves against the response URL', () => {
  assert.equal(baseOf('<base href="sub/">', BASE), 'https://source.example/guide/sub/');
  assert.equal(baseOf('<base href="//cdn.example/x/">', BASE), 'https://cdn.example/x/');
});

test('a base that cannot be parsed falls back to the response URL', () => {
  // Foreign input, so this is reachable: `http://[` is an unterminated IPv6
  // host and throws rather than resolving.
  assert.equal(baseOf('<base href="http://[">', BASE), BASE);
});

// ---- absolute URLs ---------------------------------------------------------

test('a relative URL inside a template is made absolute like any other', () => {
  const html = linked('<template shadowrootmode="open"><a href="/x">y</a></template>');
  assert.match(html, /href="https:\/\/source\.example\/x"/);
});

test('relative hrefs and srcs point back at the source', () => {
  const html = linked('<a href="../other.html">x</a><img src="img/a.png">');

  assert.match(html, /href="https:\/\/source\.example\/other\.html"/);
  assert.match(html, /src="https:\/\/source\.example\/guide\/img\/a\.png"/);
});

test('a hash-only href is made absolute, not left pointing at the host page', () => {
  // The quiet one. Left alone it addresses an id in whatever document the
  // fragment was inserted into.
  const html = linked('<a href="#install">x</a>');
  assert.match(html, /href="https:\/\/source\.example\/guide\/page\.html#install"/);
});

test('every URL-bearing attribute is covered, not just href and src', () => {
  const html = linked(
    '<video poster="p.jpg"></video><form action="/post"></form>' +
      '<button formaction="/act"></button><blockquote cite="q.html"></blockquote>' +
      '<a ping="/one /two">x</a>',
  );

  assert.match(html, /poster="https:\/\/source\.example\/guide\/p\.jpg"/);
  assert.match(html, /action="https:\/\/source\.example\/post"/);
  assert.match(html, /formaction="https:\/\/source\.example\/act"/);
  assert.match(html, /cite="https:\/\/source\.example\/guide\/q\.html"/);
  assert.match(html, /ping="https:\/\/source\.example\/one https:\/\/source\.example\/two"/);
});

test('a mailto or tel link is left as it is', () => {
  const html = linked('<a href="mailto:x@y.com">m</a><a href="tel:+15551234">t</a>');

  assert.match(html, /href="mailto:x@y\.com"/);
  assert.match(html, /href="tel:\+15551234"/);
});

test('an already absolute URL is unchanged', () => {
  const html = linked('<a href="https://other.example/x">x</a>');
  assert.match(html, /href="https:\/\/other\.example\/x"/);
});

// ---- srcset ----------------------------------------------------------------

test('a srcset candidate can contain a comma, so it is parsed rather than split', () => {
  // The reason a real parser is needed. Splitting on commas cuts this URL in
  // half and produces two broken candidates.
  const value = 'img/a,b.png 1x, img/c,d.png 2x';

  assert.deepEqual(parseSrcset(value), [
    { url: 'img/a,b.png', descriptor: '1x' },
    { url: 'img/c,d.png', descriptor: '2x' },
  ]);
});

test('a candidate with no descriptor parses, comma-terminated or not', () => {
  assert.deepEqual(parseSrcset('a.png'), [{ url: 'a.png', descriptor: '' }]);
  assert.deepEqual(parseSrcset('a.png, b.png 2x'), [
    { url: 'a.png', descriptor: '' },
    { url: 'b.png', descriptor: '2x' },
  ]);
});

test('descriptors survive rewriting and the URLs become absolute', () => {
  const html = linked('<img srcset="a.png 1x, sub/b.png 2x" src="a.png">');

  assert.match(html, /srcset="https:\/\/source\.example\/guide\/a\.png 1x, /);
  assert.match(html, /https:\/\/source\.example\/guide\/sub\/b\.png 2x"/);
});

test('imagesrcset is rewritten too', () => {
  const html = linked('<img imagesrcset="a.png 1x">');
  assert.match(html, /imagesrcset="https:\/\/source\.example\/guide\/a\.png 1x"/);
});

test('an empty srcset stays empty rather than becoming the base URL', () => {
  assert.deepEqual(parseSrcset(''), []);
  assert.deepEqual(parseSrcset('   ,,  '), []);
});

// ---- CSS -------------------------------------------------------------------

test('url() is rewritten in a style attribute and in a style block', () => {
  const html = linked(
    '<div style="background: url(bg.png)"></div><style>.a{background:url("x/y.png")}</style>',
  );

  assert.match(html, /url\(https:\/\/source\.example\/guide\/bg\.png\)/);
  assert.match(html, /url\("https:\/\/source\.example\/guide\/x\/y\.png"\)/);
});

test('quoting is preserved, single and double', () => {
  assert.equal(rewriteCss("url('a.png')", BASE), "url('https://source.example/guide/a.png')");
  assert.equal(rewriteCss('url("a.png")', BASE), 'url("https://source.example/guide/a.png")');
});

test('a data: url in CSS is left alone', () => {
  const css = 'url(data:image/gif;base64,R0lGOD)';
  assert.equal(rewriteCss(css, BASE), css);
});

test('css with no url() is untouched', () => {
  assert.equal(rewriteCss('.a { color: red }', BASE), '.a { color: red }');
});


test('a scheme reached through a tab or a control character is dropped', () => {
  // A browser strips ASCII tab and newline from a URL and ignores leading
  // controls before it reads the scheme, so each of these is a live
  // `javascript:` to it. A checker that matched the raw bytes saw a scheme-less
  // string, called it relative, and `absolutize` then turned it straight back
  // into an executable URL. Every one of these reached a real click.
  const vectors = [
    '<a href="java&#9;script:alert(1)">x</a>',
    '<a href="java&#10;script:alert(1)">x</a>',
    '<a href="java&#13;script:alert(1)">x</a>',
    '<a href="&#1;javascript:alert(1)">x</a>',
    '<a href="JAVA&#9;SCRIPT:alert(1)">x</a>',
    '<form action="java&#9;script:alert(1)"></form>',
    '<svg><a xlink:href="java&#9;script:alert(1)">x</a></svg>',
    '<a href="da&#9;ta:text/html,<b>x</b>">x</a>',
  ];

  for (const markup of vectors) {
    const root = parse(markup);
    sanitize(root, {});
    absolutize(root, BASE);
    const html = serialize(root);
    assert.doesNotMatch(html, /javascript:/i, markup);
    assert.doesNotMatch(html, /data:text\/html/i, markup);
  }
});

test('schemeOf reads the scheme a browser would act on, not the bytes', () => {
  assert.equal(schemeOf('java\tscript:alert(1)'), 'javascript');
  assert.equal(schemeOf('javascript:x'), 'javascript');
  assert.equal(schemeOf('  \nHTTPS://x'), 'https');
  assert.equal(schemeOf('/relative/path'), null);
  assert.equal(schemeOf('#anchor'), null);
  // A form feed inside the scheme is not stripped by the URL parser, so it
  // stays scheme-breaking here too rather than reading as `javascript:`.
  assert.equal(schemeOf('java\fscript:x'), null);
});

test('a data: image survives, and a data: document does not', () => {
  const ok = clean('<img src="data:image/png;base64,AAAA">');
  assert.match(ok.html, /data:image\/png/);

  const bad = clean('<a href="data:text/html,<b>x</b>">x</a>');
  assert.doesNotMatch(bad.html, /data:text\/html/);
});
