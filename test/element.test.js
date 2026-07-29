// The custom element half of the runtime: members on the prototype, the
// updated() hook, and the abort signal.
//
// The fake DOM is deliberately tiny. It implements only what defineComponent
// and defineLight actually touch, so a test failing here means the runtime
// changed, not that the fake fell behind a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceProps } from '../src/runtime/index.js';
import { createRoot } from './dom.js';

class FakeHTMLElement {
  #attrs = new Map();
  shadowRoot = null;
  isConnected = false;

  get attributes() {
    return [...this.#attrs].map(([name, value]) => ({ name, value }));
  }
  attachShadow() {
    this.shadowRoot = createRoot();
    return this.shadowRoot;
  }
  getAttribute(name) {
    return this.#attrs.has(name) ? this.#attrs.get(name) : null;
  }
  setAttribute(name, value) {
    const old = this.getAttribute(name);
    this.#attrs.set(name, String(value));
    if (old !== String(value)) this.#changed(name);
  }
  removeAttribute(name) {
    if (this.#attrs.delete(name)) this.#changed(name);
  }
  hasAttribute(name) {
    return this.#attrs.has(name);
  }
  toggleAttribute(name, force) {
    const on = force ?? !this.hasAttribute(name);
    if (on) this.setAttribute(name, '');
    else this.removeAttribute(name);
    return on;
  }
  #changed(name) {
    const observed = this.constructor.observedAttributes ?? [];
    if (this.isConnected && observed.includes(name)) this.attributeChangedCallback?.(name);
  }

  // Standing in for the parser and for insertBefore/remove.
  connect() {
    this.isConnected = true;
    this.connectedCallback?.();
  }
  disconnect() {
    this.isConnected = false;
    this.disconnectedCallback?.();
  }
}

/** Fresh globals per test: customElements can only define a tag once. */
async function withDom(run) {
  const registry = new Map();
  const saved = {
    HTMLElement: globalThis.HTMLElement,
    customElements: globalThis.customElements,
  };
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.customElements = {
    define: (tag, Class) => registry.set(tag, Class),
    get: (tag) => registry.get(tag),
  };
  try {
    // Imported fresh so nothing leaks between cases.
    const runtime = await import(`../src/runtime/index.js?${registry.size}-${Math.random()}`);
    return await run(runtime, registry);
  } finally {
    Object.assign(globalThis, saved);
  }
}

const PROP_DEFS = { name: 'Anonymous', pageSize: 10, compact: false };

const defOf = (overrides = {}) => ({
  tag: 'x-card',
  css: '',
  propDefs: PROP_DEFS,
  members: {},
  render: (props) => `<h3>${props.name}</h3>`,
  // What the compiler emits: attributes in, declared props out.
  coerce: (props) => coerceProps(PROP_DEFS, props),
  ...overrides,
});

test('<script element> members land on the prototype, not the instance', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(
      defOf({ members: { shout() { return `hi ${this.name}`; } } }),
      null,
    );
    const Class = registry.get('x-card');
    const el = new Class();

    assert.ok(Object.hasOwn(Class.prototype, 'shout'));
    assert.ok(!Object.hasOwn(el, 'shout'));
    assert.equal(el.shout(), 'hi Anonymous');
  });
});

test('a getter member is defined, not invoked, at define time', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let reads = 0;
    const members = {
      get doubled() {
        reads++;
        return this.pageSize * 2;
      },
    };
    defineComponent(defOf({ members }), null);
    assert.equal(reads, 0, 'Object.assign would have read it once here');

    const el = new (registry.get('x-card'))();
    el.setAttribute('page-size', '21');
    assert.equal(el.doubled, 42);
    assert.equal(reads, 1);
  });
});

test('a member that would shadow a DOM member is refused', async () => {
  await withDom(async ({ defineComponent }) => {
    assert.throws(
      () => defineComponent(defOf({ members: { getAttribute() {} } }), null),
      /getAttribute.*already exists/s,
    );
  });
});

test('a member that would shadow a declared prop is refused', async () => {
  await withDom(async ({ defineComponent }) => {
    assert.throws(
      () => defineComponent(defOf({ members: { compact() {} } }), null),
      /compact.*already exists/s,
    );
  });
});

test('updated() runs on connect and after every re-render', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    const seen = [];
    defineComponent(
      defOf({ members: { updated() { seen.push(this.shadowRoot.html); } } }),
      null,
    );
    const el = new (registry.get('x-card'))();

    el.connect();
    assert.deepEqual(seen, ['<h3>Anonymous</h3>'], 'once for the markup it was served');

    el.name = 'Ada';
    await el.updateComplete;
    assert.deepEqual(seen.at(-1), '<h3>Ada</h3>', 'and again with the new shadow content');
    assert.equal(seen.length, 2);
  });
});

test('updated() runs after the paint, so it sees the current shadow root', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let sawStale = false;
    defineComponent(
      defOf({
        members: {
          updated() {
            if (this.shadowRoot.html.includes('Anonymous') && this.name !== 'Anonymous') {
              sawStale = true;
            }
          },
        },
      }),
      null,
    );
    const el = new (registry.get('x-card'))();
    el.connect();
    el.name = 'Ada';
    await el.updateComplete;
    assert.equal(sawStale, false);
  });
});

test('the signal passed to <script> aborts when the element leaves', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let signal = null;
    defineComponent(defOf(), (host, shadow, incoming) => {
      signal = incoming;
    });
    const el = new (registry.get('x-card'))();

    el.connect();
    assert.equal(signal.aborted, false);
    el.disconnect();
    assert.equal(signal.aborted, true);
  });
});

test('reconnecting gives a fresh signal rather than an already-aborted one', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    const signals = [];
    defineComponent(defOf(), (host, shadow, signal) => void signals.push(signal));
    const el = new (registry.get('x-card'))();

    el.connect();
    el.disconnect();
    el.connect();

    assert.equal(signals.length, 2);
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false, 'a moved element must still work');
  });
});

test('the returned cleanup still runs, alongside the signal', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let cleaned = false;
    defineComponent(defOf(), () => () => {
      cleaned = true;
    });
    const el = new (registry.get('x-card'))();

    el.connect();
    el.disconnect();
    await Promise.resolve();
    assert.equal(cleaned, true);
  });
});

test('a partial with only <script element> still upgrades', async () => {
  await withDom(async ({ defineLight }, registry) => {
    defineLight(defOf({ tag: 'x-note', members: { dismiss() { return this.name; } } }), null);
    const Class = registry.get('x-note');
    assert.ok(Class, 'members are a reason to register, even with no <script>');

    const el = new Class();
    el.setAttribute('name', 'Ada');
    assert.equal(el.dismiss(), 'Ada');
  });
});

test('a partial with neither block still ships nothing', async () => {
  await withDom(async ({ defineLight }, registry) => {
    defineLight(defOf({ tag: 'x-plain' }), null);
    assert.equal(registry.get('x-plain'), undefined);
  });
});

test('a light element gets updated() once per connect, since it never repaints', async () => {
  await withDom(async ({ defineLight }, registry) => {
    let count = 0;
    defineLight(defOf({ tag: 'x-note', members: { updated() { count++; } } }), null);
    const el = new (registry.get('x-note'))();

    el.connect();
    el.name = 'Ada';
    assert.equal(count, 1);
  });
});

// ---- surgical updates -----------------------------------------------------

const bindingDef = (overrides = {}) => {
  // Stands in for what the compiler emits: one text binding, one attribute.
  const defs = { name: 'Anonymous', role: '' };
  return {
    tag: 'x-bound',
    css: '',
    propDefs: defs,
    members: {},
    volatile: [],
    render: (props) => `<h3>${props.name}</h3><p title="${props.role}"></p>`,
    coerce: (props) => coerceProps(defs, props),
    bind: (root) => [root.childNodes[0].firstChild, root.childNodes[1]],
    update: (b, d) => {
      b[0].data = d.name;
      b[1].setAttribute('title', d.role);
      return true;
    },
    ...overrides,
  };
};

test('a bound change writes into the existing nodes instead of replacing them', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(bindingDef(), null);
    const el = new (registry.get('x-bound'))();
    el.connect();

    const heading = el.shadowRoot.childNodes[0];
    el.name = 'Ada';
    await el.updateComplete;

    assert.equal(el.shadowRoot.childNodes[0], heading, 'the node was replaced');
    assert.equal(heading.firstChild.data, 'Ada');
  });
});

test('a volatile change falls back to a full repaint', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let repaints = 0;
    defineComponent(
      bindingDef({
        volatile: ['role'],
        render(props) {
          repaints++;
          return `<h3>${props.name}</h3><p title="${props.role}"></p>`;
        },
      }),
      null,
    );
    const el = new (registry.get('x-bound'))();
    el.connect();
    // Connecting with no server-rendered shadow root paints once by definition.
    repaints = 0;

    el.name = 'Ada';
    await el.updateComplete;
    assert.equal(repaints, 0, 'a bound prop must not repaint');

    el.role = 'Analyst';
    await el.updateComplete;
    assert.equal(repaints, 1, 'a volatile prop must');
  });
});

test('update() handing back false forces the repaint', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let repaints = 0;
    defineComponent(
      bindingDef({
        update: () => false,
        render(props) {
          repaints++;
          return `<h3>${props.name}</h3><p title=""></p>`;
        },
      }),
      null,
    );
    const el = new (registry.get('x-bound'))();
    el.connect();
    repaints = 0;

    el.name = 'Ada';
    await el.updateComplete;
    assert.equal(repaints, 1);
  });
});

test('reconnecting does not bind a second time', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let binds = 0;
    const def = bindingDef();
    defineComponent({ ...def, bind: (root) => { binds++; return def.bind(root); } }, null);
    const el = new (registry.get('x-bound'))();

    el.connect();
    el.disconnect();
    el.connect();

    // Binding twice would re-split every text node it already carved.
    assert.equal(binds, 1);
  });
});

// ---- internal state and batching ------------------------------------------

const stateDef = (overrides = {}) => {
  const props = { name: 'Anonymous' };
  const state = { open: false, count: 0 };
  return {
    tag: 'x-state',
    css: '',
    propDefs: props,
    stateDefs: state,
    members: {},
    volatile: [],
    render: (d) => `<h3>${d.name}</h3><p>${d.count}${d.open ? '!' : ''}</p>`,
    coerce: (p) => coerceProps(props, p),
    bind: (root) => [root.childNodes[0].firstChild, root.childNodes[1]],
    update: (b, d) => {
      b[0].data = d.name;
      b[1].childNodes[0].data = `${d.count}${d.open ? '!' : ''}`;
      return true;
    },
    ...overrides,
  };
};

test('state is a field on the instance, not an attribute', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(stateDef(), null);
    const el = new (registry.get('x-state'))();
    el.connect();

    assert.equal(el.open, false, 'the declared default');
    el.open = true;

    assert.equal(el.open, true, 'reads back synchronously');
    assert.equal(el.getAttribute('open'), null, 'state leaked into the document');
    assert.equal(el.hasAttribute('open'), false);
  });
});

test('state reaches the template, and an assignment renders', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(stateDef(), null);
    const el = new (registry.get('x-state'))();
    el.connect();
    assert.match(el.shadowRoot.html, /<p>0<\/p>/);

    el.count = 7;
    await el.updateComplete;
    assert.match(el.shadowRoot.html, /<p>7<\/p>/);
  });
});

test('two assignments in a row are one render, not two', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let updates = 0;
    const def = stateDef();
    defineComponent({ ...def, update: (b, d) => (updates++, def.update(b, d)) }, null);
    const el = new (registry.get('x-state'))();
    el.connect();
    updates = 0;

    el.count = 1;
    el.open = true;
    el.name = 'Ada';
    assert.equal(updates, 0, 'nothing should have run yet');

    await el.updateComplete;
    assert.equal(updates, 1, 'three changes, one render');
    assert.match(el.shadowRoot.html, /<h3>Ada<\/h3><p>1!<\/p>/);
  });
});

test('setting state to the value it already has schedules nothing', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let updates = 0;
    const def = stateDef();
    defineComponent({ ...def, update: (b, d) => (updates++, def.update(b, d)) }, null);
    const el = new (registry.get('x-state'))();
    el.connect();
    updates = 0;

    el.count = 0;
    await el.updateComplete;
    assert.equal(updates, 0);
  });
});

test('updateComplete with nothing pending is already resolved', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(stateDef(), null);
    const el = new (registry.get('x-state'))();
    el.connect();
    assert.ok(el.updateComplete instanceof Promise);
    await el.updateComplete;
  });
});

test('volatile state forces a repaint, comparing values rather than attributes', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let repaints = 0;
    const def = stateDef();
    defineComponent(
      {
        ...def,
        // `open` drives structure the compiler could not bind.
        volatile: ['open'],
        render(d) {
          repaints++;
          return def.render(d);
        },
      },
      null,
    );
    const el = new (registry.get('x-state'))();
    el.connect();
    repaints = 0;

    el.count = 3;
    await el.updateComplete;
    assert.equal(repaints, 0, 'a bound field must not repaint');

    el.open = true;
    await el.updateComplete;
    assert.equal(repaints, 1, 'a volatile field must');
  });
});

test('state that would shadow a DOM member is refused', async () => {
  await withDom(async ({ defineComponent }) => {
    // The check is `in`, which walks the real chain; the fake DOM here only
    // carries the methods the runtime calls, so the collision is tested against
    // one of those. A genuine HTMLElement member is covered in the browser.
    assert.throws(
      () => defineComponent(stateDef({ stateDefs: { getAttribute: '' } }), null),
      /getAttribute.*already exists/s,
    );
  });
});

test('state that would shadow a declared prop is refused at runtime too', async () => {
  await withDom(async ({ defineComponent }) => {
    // The compiler rejects this outright; the runtime is the second line, for a
    // def assembled by hand.
    assert.throws(
      () => defineComponent(stateDef({ stateDefs: { name: '' } }), null),
      /name.*already exists/s,
    );
  });
});

test('each instance gets its own state', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(stateDef(), null);
    const Class = registry.get('x-state');
    const one = new Class();
    const two = new Class();
    one.connect();
    two.connect();

    one.count = 5;
    await one.updateComplete;

    assert.equal(one.count, 5);
    assert.equal(two.count, 0, 'state was shared between instances');
  });
});

test('state set from a <script> block before the first paint still lands', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(stateDef(), (host) => {
      host.count = 42;
    });
    const el = new (registry.get('x-state'))();
    el.connect();

    await el.updateComplete;
    assert.match(el.shadowRoot.html, /<p>42<\/p>/);
  });
});

test('a property setter writes the attribute through the converter', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    const defs = { since: new Date(0) };
    defineComponent(
      {
        tag: 'x-conv',
        css: '',
        propDefs: defs,
        propAttrs: {
          since: {
            from: (text) => new Date(text),
            to: (date) => date.toISOString().slice(0, 10),
          },
        },
        stateDefs: {},
        members: {},
        volatile: [],
        render: (d) => `<time>${d.since.getUTCFullYear()}</time>`,
        coerce(props) {
          return coerceProps(defs, props, this.propAttrs);
        },
      },
      null,
    );
    const el = new (registry.get('x-conv'))();
    el.connect();

    el.since = new Date('1843-12-10');
    assert.equal(el.getAttribute('since'), '1843-12-10', 'the attribute is not JSON');

    assert.ok(el.since instanceof Date, 'the getter did not run `from`');
    assert.equal(el.since.getUTCFullYear(), 1843);

    await el.updateComplete;
    assert.match(el.shadowRoot.html, /<time>1843<\/time>/);
  });
});
