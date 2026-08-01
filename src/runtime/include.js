// `<transclude-fragment loading="lazy">`, in the browser.
//
// The same element as the server-time one and the same `src`. What differs is
// when: without `loading` the markup is in the page that arrives, and with it
// the element is in the page and fills itself later. That is the trade
// `<img loading="lazy">` makes, spelled the same way.
//
// This is the one thing here that swaps content into a page. It is an element
// with a `src`, like `<img>` and `<iframe>`, not an attribute you can put on
// anything: no trigger, no target, no swap strategy, no polling.

export const INCLUDE_TAG = 'transclude-fragment';
export const DEPTH_ATTR = 'data-transclude-depth';
export const MAX_DEPTH = 10;

/**
 * Where the browser asks for a fragment.
 *
 * A route of this app is asked with the query parameter the server already
 * answers. Another site goes through this origin's proxy, which is not a
 * preference: the default policy names `'self'`, so a cross-origin fetch from a
 * page is refused before it leaves.
 */
export function requestUrl(src) {
  const at = String(src ?? '').indexOf('#');
  if (at === -1) return null;

  const where = src.slice(0, at);
  const id = src.slice(at + 1);
  if (!id) return null;
  // Same document: nothing to ask anyone for.
  if (!where) return { kind: 'self', id };

  if (where.startsWith('/')) {
    const url = new URL(where, 'http://x');
    url.searchParams.set('fragment', id);
    return { kind: 'route', url: `${url.pathname}${url.search}` };
  }
  return {
    kind: 'foreign',
    url: `/_transclude/proxy?url=${encodeURIComponent(where)}&id=${encodeURIComponent(id)}`,
  };
}

/** Nodes from markup, with declarative shadow roots actually attached. */
export function parseNodes(html, doc = document) {
  // `innerHTML` and `DOMParser` both leave `<template shadowrootmode>` inert, so
  // a component inside a fetched fragment would arrive as a dead template and
  // never paint. These two are the ones that process it.
  if (typeof Document !== 'undefined' && Document.parseHTMLUnsafe) {
    return [...Document.parseHTMLUnsafe(html).body.childNodes];
  }

  const host = doc.createElement('div');
  if (host.setHTMLUnsafe) host.setHTMLUnsafe(html);
  else host.innerHTML = html;
  return [...host.childNodes];
}

export function defineInclude() {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(INCLUDE_TAG)) return;

  class Fragment extends HTMLElement {
    static observedAttributes = ['src'];

    #abort = null;
    #watcher = null;
    #depth = 0;

    connectedCallback() {
      // How far in a chain of includes this one is. Written onto what it
      // inserts, so a page that includes a page that includes this one stops
      // rather than going round forever. There is no build step to catch it.
      const above = this.closest(`[${DEPTH_ATTR}]`);
      this.#depth = Number(above?.getAttribute(DEPTH_ATTR) ?? 0);

      if (this.getAttribute('loading') === 'lazy') this.#watch();
      else this.load();
    }

    disconnectedCallback() {
      this.#stop();
    }

    attributeChangedCallback(name, before, after) {
      // Not on the first set: `connectedCallback` starts the only load that a
      // fresh element wants, and this would make it two.
      if (name === 'src' && before !== null && before !== after && this.isConnected) this.load();
    }

    #watch() {
      if (typeof IntersectionObserver === 'undefined') return this.load();

      // An observer measures a border box, and an unknown element is
      // `display: inline`, whose box it never sees. Measured: the element had a
      // 743x23 rect, sat in the viewport, and the observer never fired once.
      // Nothing says so, which is what makes it worth doing here rather than
      // asking every page for a stylesheet rule.
      if (getComputedStyle(this).display === 'inline') this.style.display = 'block';
      this.#watcher = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          this.#stopWatching();
          this.load();
        },
        { rootMargin: '256px' },
      );
      this.#watcher.observe(this);
    }

    #stopWatching() {
      this.#watcher?.disconnect();
      this.#watcher = null;
    }

    #stop() {
      this.#stopWatching();
      this.#abort?.abort();
      this.#abort = null;
      this.removeAttribute('aria-busy');
    }

    #fail(message) {
      this.dispatchEvent(new CustomEvent('error', { detail: { message } }));
      this.dispatchEvent(new CustomEvent('loadend'));
    }

    /** Fetch and swap. Safe to call again: the request in flight is dropped. */
    async load() {
      const target = requestUrl(this.getAttribute('src'));
      if (!target) return this.#fail('src needs a "#id"');

      if (this.#depth >= MAX_DEPTH) {
        return this.#fail(`${MAX_DEPTH} includes deep, which is as far as this goes`);
      }

      // A later src wins outright. Without this the slower of two requests can
      // land second and put back what the newer one replaced.
      this.#abort?.abort();
      const abort = new AbortController();
      this.#abort = abort;

      if (!this.dispatchEvent(new CustomEvent('loadstart', { cancelable: true }))) return;
      this.setAttribute('aria-busy', 'true');

      try {
        let nodes;
        if (target.kind === 'self') {
          const found = this.ownerDocument.getElementById(target.id);
          if (!found) throw new Error(`no #${target.id} in this document`);
          nodes = [found.cloneNode(true)];
        } else {
          const response = await fetch(target.url, {
            signal: abort.signal,
            headers: { accept: 'text/html' },
          });
          if (!response.ok) throw new Error(`the source answered ${response.status}`);
          nodes = parseNodes(await response.text(), this.ownerDocument);
        }

        if (abort.signal.aborted) return;
        this.#swap(nodes);
      } catch (error) {
        if (abort.signal.aborted) return;
        this.removeAttribute('aria-busy');
        this.#fail(error.message);
      } finally {
        if (this.#abort === abort) this.#abort = null;
      }
    }

    #swap(nodes) {
      const swap = new CustomEvent('transclude:beforeswap', {
        cancelable: true,
        detail: { nodes },
      });
      if (!this.dispatchEvent(swap)) {
        this.removeAttribute('aria-busy');
        return;
      }

      for (const node of nodes) {
        if (node.nodeType === 1) node.setAttribute(DEPTH_ATTR, String(this.#depth + 1));
      }

      this.removeAttribute('aria-busy');

      if (this.hasAttribute('keep')) {
        // A host that stays, for anything that loads more than once.
        this.replaceChildren(...nodes);
        this.dispatchEvent(new CustomEvent('load'));
        this.dispatchEvent(new CustomEvent('loadend'));
        return;
      }

      // Gone, leaving what it fetched in its place. A region is several nodes
      // where it is declared, so a wrapper here would mean the fetched markup
      // did not match the markup it came from.
      const parent = this.parentNode;
      this.dispatchEvent(new CustomEvent('load'));
      this.dispatchEvent(new CustomEvent('loadend'));
      if (parent) this.replaceWith(...nodes);
    }
  }

  customElements.define(INCLUDE_TAG, Fragment);
}
