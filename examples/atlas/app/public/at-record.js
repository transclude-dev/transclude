// <at-record> — put one AT Protocol record on any page.
//
//   <script type="module" src="https://atlas.transclude.dev/at-record.js"></script>
//
//   <at-record uri="at://did:plc:abc/app.bsky.feed.post/3k2j">
//     <a href="https://bsky.app/...">Read this post</a>
//   </at-record>
//
// The children are the fallback. They show until the record arrives, and they
// stay if it never does, so a page with this element on it is never broken by
// this element: no script, no network, old browser, all the same.
//
// Light DOM, deliberately. A shadow root would keep the host page's stylesheet
// out, and that stylesheet reaching the record is the entire reason this serves
// HTML instead of an iframe.
//
// No framework. This file is what it looks like: a fetch and an insert. It is
// hand-written rather than exported from the app that serves it, because the
// app's element runtime is four kilobytes and this needs none of it.

/** Where the record markup lives, given what the tag was told. */
export function embedUrl(uri, { host, fragment = 'record' } = {}) {
  const path = String(uri ?? '')
    .trim()
    .replace(/^at:\/\//, '');

  if (!path) throw new Error('<at-record> needs a uri.');
  if (path.split('/').filter(Boolean).length !== 3) {
    throw new Error(`<at-record uri="${uri}"> names ${path.split('/').filter(Boolean).length} parts. A record has three.`);
  }

  const url = new URL(`/embed/${path}`, host);
  if (fragment) url.searchParams.set('fragment', fragment);
  return url.toString();
}

// Where this file was served from. An element loaded from one atlas asks that
// same atlas, so nothing has to name a host twice and a self-hosted copy works
// with no configuration at all.
const ORIGIN = new URL('.', import.meta.url).origin;

if (typeof HTMLElement !== 'undefined' && !customElements.get('at-record')) {
  class AtRecord extends HTMLElement {
    static observedAttributes = ['uri', 'fragment', 'host'];

    /** @type {AbortController|null} */
    #inflight = null;

    connectedCallback() {
      this.#load();
    }

    disconnectedCallback() {
      this.#inflight?.abort();
    }

    attributeChangedCallback() {
      // Ignored before the element is in the document, because connectedCallback
      // is about to run and two loads would race for the same children.
      if (this.isConnected) this.#load();
    }

    async #load() {
      // A second load cancels the first. Without this, a slow response for an
      // old `uri` can land after a fast one for the new `uri` and win.
      this.#inflight?.abort();
      const inflight = new AbortController();
      this.#inflight = inflight;

      let url;
      try {
        url = embedUrl(this.getAttribute('uri'), {
          host: this.getAttribute('host') || ORIGIN,
          fragment: this.getAttribute('fragment') ?? 'record',
        });
      } catch (error) {
        return this.#failed(error);
      }

      this.dataset.state = 'loading';

      try {
        const res = await fetch(url, { signal: inflight.signal });
        if (!res.ok) throw new Error(`${url} answered ${res.status}.`);

        const html = await res.text();
        if (inflight.signal.aborted) return;

        // setHTMLUnsafe builds declarative shadow roots from the markup it is
        // given. Nothing served here uses one today, and an element that has to
        // work on somebody else's page for years should not depend on that
        // staying true.
        if (this.setHTMLUnsafe) this.setHTMLUnsafe(html);
        else this.innerHTML = html;

        this.dataset.state = 'ready';
      } catch (error) {
        if (inflight.signal.aborted) return;
        this.#failed(error);
      }
    }

    /**
     * Leave the children alone. They are the author's fallback, they are already
     * on the page, and replacing them with an error message would put this
     * app's problem in somebody else's article.
     */
    #failed(error) {
      this.dataset.state = 'failed';
      this.dispatchEvent(new CustomEvent('at-record:error', { detail: error, bubbles: true }));
    }
  }

  customElements.define('at-record', AtRecord);
}
