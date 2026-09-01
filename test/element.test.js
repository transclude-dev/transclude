// The custom element half of the runtime: members on the prototype, the
// updated() hook, and the abort signal.
//
// The fake DOM is small on purpose. It implements only what defineComponent
// and defineLight actually touch, so a test failing here means the runtime
// changed, not that the fake fell behind a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  /** Enough ElementInternals to see what would be submitted, and custom states. */
  attachInternals() {
    this.reported = [];
    const reported = this.reported;
    return {
      form: null,
      setFormValue: (value) => reported.push(value),
      setValidity() {},
      // A `CustomStateSet` is a Set of state names; the runtime uses add/delete.
      states: new Set(),
    };
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

test('exported prototype members land on the prototype, not the instance', async () => {
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
    defineComponent(defOf({ members }));
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
      () => defineComponent(defOf({ members: { getAttribute() {} } })),
      /getAttribute.*already has/s,
    );
  });
});

test('a member that would shadow a declared prop is refused', async () => {
  await withDom(async ({ defineComponent }) => {
    assert.throws(
      () => defineComponent(defOf({ members: { compact() {} } })),
      /compact.*already has/s,
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

test('the signal `connected` is handed aborts when the element leaves', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let signal = null;
    defineComponent(defOf({ members: { connected: ({ signal: incoming }) => void (signal = incoming) } }));
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
    defineComponent(defOf({ members: { connected: ({ signal }) => void signals.push(signal) } }));
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
    defineComponent(
      defOf({
        members: {
          connected: () => () => {
            cleaned = true;
          },
        },
      }),
    );
    const el = new (registry.get('x-card'))();

    el.connect();
    el.disconnect();
    await Promise.resolve();
    assert.equal(cleaned, true);
  });
});

test('disconnected runs when the element leaves', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let gone = 0;
    defineComponent(defOf({ members: { disconnected: () => void (gone += 1) } }));
    const el = new (registry.get('x-card'))();

    el.connect();
    assert.equal(gone, 0);
    el.disconnect();
    assert.equal(gone, 1);
  });
});

test('disconnected runs on every disconnect, the way connected runs on every connect', async () => {
  // Moving an element in the document is a disconnect and a connect. Both hooks
  // pair off, or one of them stops matching the other after the first move.
  await withDom(async ({ defineComponent }, registry) => {
    const order = [];
    defineComponent(
      defOf({
        members: {
          connected: () => void order.push('in'),
          disconnected: () => void order.push('out'),
        },
      }),
    );
    const el = new (registry.get('x-card'))();

    el.connect();
    el.disconnect();
    el.connect();
    el.disconnect();

    assert.deepEqual(order, ['in', 'out', 'in', 'out']);
  });
});

test('`this` is the element inside disconnected', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let saw = null;
    defineComponent(
      defOf({
        members: {
          disconnected() {
            saw = this;
          },
        },
      }),
    );
    const el = new (registry.get('x-card'))();

    el.connect();
    el.disconnect();

    assert.equal(saw, el);
  });
});

test('the signal is already aborted by the time disconnected runs', async () => {
  // It is the element leaving, so every listener that was given the signal has
  // gone. A member that reads it should see that rather than a live one.
  await withDom(async ({ defineComponent }, registry) => {
    let signal = null;
    let abortedThen = null;
    defineComponent(
      defOf({
        members: {
          connected: ({ signal: incoming }) => void (signal = incoming),
          disconnected: () => void (abortedThen = signal.aborted),
        },
      }),
    );
    const el = new (registry.get('x-card'))();

    el.connect();
    el.disconnect();

    assert.equal(abortedThen, true);
  });
});

test('the cleanup connected returned runs before disconnected', async () => {
  // One order, written down. The returned function is the tail of `connected`
  // and belongs to that connection; `disconnected` is the element's own hook and
  // sees the connection already undone.
  await withDom(async ({ defineComponent }, registry) => {
    const order = [];
    defineComponent(
      defOf({
        members: {
          connected: () => () => void order.push('cleanup'),
          disconnected: () => void order.push('disconnected'),
        },
      }),
    );
    const el = new (registry.get('x-card'))();

    el.connect();
    el.disconnect();

    assert.deepEqual(order, ['cleanup', 'disconnected']);
  });
});

test('a moved element runs the old cleanup before the new connect', async () => {
  // It used to be handed to a microtask even when it was already a function, so
  // the first connection's cleanup ran after the second `connected` had set
  // everything up again and tore down what it had just built.
  await withDom(async ({ defineComponent }, registry) => {
    const order = [];
    defineComponent(
      defOf({
        members: {
          connected() {
            order.push('connected');
            return () => order.push('cleanup');
          },
        },
      }),
    );
    const el = new (registry.get('x-card'))();

    el.connect();
    el.disconnect();
    el.connect();

    assert.deepEqual(order, ['connected', 'cleanup', 'connected']);
  });
});

test('an async connected still has its cleanup run, late but run', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    let cleaned = false;
    defineComponent(
      defOf({
        members: {
          connected: async () => () => {
            cleaned = true;
          },
        },
      }),
    );
    const el = new (registry.get('x-card'))();

    el.connect();
    await Promise.resolve();
    el.disconnect();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(cleaned, true);
  });
});

test('a partial with only an exported prototype still upgrades', async () => {
  await withDom(async ({ defineLight }, registry) => {
    defineLight(defOf({ tag: 'x-note', members: { dismiss() { return this.name; } } }));
    const Class = registry.get('x-note');
    assert.ok(Class, 'members are a reason to register, even with no <script>');

    const el = new Class();
    el.setAttribute('name', 'Ada');
    assert.equal(el.dismiss(), 'Ada');
  });
});

test('a partial with neither block still ships nothing', async () => {
  await withDom(async ({ defineLight }, registry) => {
    defineLight(defOf({ tag: 'x-plain' }));
    assert.equal(registry.get('x-plain'), undefined);
  });
});

test('a light element gets updated() once per connect, since it never repaints', async () => {
  await withDom(async ({ defineLight }, registry) => {
    let count = 0;
    defineLight(defOf({ tag: 'x-note', members: { updated() { count++; } } }));
    const el = new (registry.get('x-note'))();

    el.connect();
    el.name = 'Ada';
    assert.equal(count, 1);
  });
});

// ---- updates in place -----------------------------------------------------

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
    defineComponent(bindingDef());
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
    defineComponent({ ...def, bind: (root) => { binds++; return def.bind(root); } });
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
    defineComponent(stateDef());
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
    defineComponent(stateDef());
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
    defineComponent({ ...def, update: (b, d) => (updates++, def.update(b, d)) });
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
    defineComponent({ ...def, update: (b, d) => (updates++, def.update(b, d)) });
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
    defineComponent(stateDef());
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
      () => defineComponent(stateDef({ stateDefs: { getAttribute: '' } })),
      /getAttribute.*already exists/s,
    );
  });
});

test('state that would shadow a declared prop is refused at runtime too', async () => {
  await withDom(async ({ defineComponent }) => {
    // The compiler rejects this outright; the runtime is the second line, for a
    // def assembled by hand.
    assert.throws(
      () => defineComponent(stateDef({ stateDefs: { name: '' } })),
      /name.*already exists/s,
    );
  });
});

test('each instance gets its own state', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(stateDef());
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

test('state set from `connected` before the first paint still lands', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(
      stateDef({
        members: {
          connected() {
            this.count = 42;
          },
        },
      }),
    );
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


// ---- form association ------------------------------------------------------
//
// The browser half is in app/routes/check.html, because nothing here has a real
// form. That is where a <form> counting it as a field, and reset working, are
// checked. What is worth checking here is the rule for turning a prop into
// something a form can submit.

const controlOf = (overrides = {}) => ({
  ...defOf(overrides),
  formAssociated: true,
  propDefs: { value: '', ...(overrides.propDefs ?? {}) },
  coerce: (props) => coerceProps({ value: '', ...(overrides.propDefs ?? {}) }, props),
});

test('the static flag is what a form reads to decide it is a control', async () => {
  // Nothing in Node models a form, so this is the only place the flag itself can
  // be checked here. app/routes/check.html checks the result in a browser.
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(controlOf());
    assert.equal(registry.get('x-card').formAssociated, true);
  });
});

test('a control reports its value when it connects', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(controlOf());
    const element = new (registry.get('x-card'))();
    element.setAttribute('value', 'ada');
    element.connect();

    assert.deepEqual(element.reported.at(-1), 'ada');
  });
});

test('a change is reported before the render, not after', async () => {
  // A form can be submitted between the attribute changing and the microtask that
  // repaints. What it sends has to be what the attribute already says.
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(controlOf());
    const element = new (registry.get('x-card'))();
    element.connect();
    element.reported.length = 0;

    element.value = 'grace';
    assert.deepEqual(element.reported, ['grace'], 'nothing was reported synchronously');
  });
});

test('an object value is serialized the way its attribute is', async () => {
  // What gets submitted is what the DOM says, rather than "[object Object]".
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(controlOf({ propDefs: { value: [] } }));
    const element = new (registry.get('x-card'))();
    element.connect();
    element.reported.length = 0;

    element.value = ['a', 'b'];
    assert.equal(element.reported.at(-1), '["a","b"]');
    assert.equal(element.getAttribute('value'), '["a","b"]');
  });
});

test('an absent value is reported as null, not as the string "null"', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(controlOf({ propDefs: { value: null } }));
    const element = new (registry.get('x-card'))();
    element.connect();

    assert.equal(element.reported.at(-1), null);
  });
});

test('a control with no value prop reports nothing rather than guessing', async () => {
  // It can still report validity through internals, so this is allowed.
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent({ ...defOf(), formAssociated: true, propDefs: { label: '' } });
    const element = new (registry.get('x-card'))();
    element.connect();

    assert.deepEqual(element.reported, []);
  });
});

test('reset removes the attribute rather than blanking it', async () => {
  // Removing is what puts the prop back to the default its properties block
  // declared, because that is what the getter falls back to.
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(controlOf({ propDefs: { value: 'default' } }));
    const element = new (registry.get('x-card'))();
    element.connect();
    element.value = 'changed';

    element.formResetCallback();
    assert.equal(element.getAttribute('value'), null);
    assert.equal(element.value, 'default');
  });
});

test('a form disabling its controls reflects to a state, not the attribute', async () => {
  // The attribute is the trap this used to fall into: a form-associated element
  // with its own `disabled` attribute is disabled by the browser's reckoning, so
  // once set the browser stops firing `formDisabledCallback(false)` and the
  // control stays disabled after its fieldset lets go. A custom state reflects
  // the container without feeding back, so both calls arrive.
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(controlOf({ propDefs: { value: '', disabled: false } }));
    const element = new (registry.get('x-card'))();
    element.connect();

    element.formDisabledCallback(true);
    assert.ok(element.internals.states.has('disabled'), 'disabled reflects to a state');
    assert.equal(element.getAttribute('disabled'), null, 'and not to the latching attribute');

    element.formDisabledCallback(false);
    assert.ok(!element.internals.states.has('disabled'), 're-enabling clears the state');
  });
});

test('an ordinary component gets no internals and reports nothing', async () => {
  await withDom(async ({ defineComponent }, registry) => {
    defineComponent(defOf());
    const Class = registry.get('x-card');

    assert.equal(Class.formAssociated, false);
    assert.equal(new Class().internals, null);
  });
});

test('the message names the block the member is actually written in', async () => {
  // It named `<script element>`, which has not existed for some time. Somebody
  // hit this with a member called `click` and went looking for a block that was
  // not there.
  await withDom(async ({ defineComponent }) => {
    assert.throws(
      () => defineComponent(defOf({ members: { getAttribute() {} } })),
      /export const prototype/,
    );
    assert.throws(
      () => defineComponent(defOf({ members: { getAttribute() {} } })),
      (error) => !/<script element>/.test(error.message),
    );
  });
});

// ---- a light element re-renders ------------------------------------------

test('a light element observes every declared prop', async () => {
  // It observed nothing unless it was form-associated, so an attribute change
  // reached the DOM and nothing else.
  await withDom(async ({ defineLight }, registry) => {
    const def = defOf({ light: true, propDefs: { count: 0, label: '' }, members: { connected() {} } });
    defineLight(def);

    assert.deepEqual(registry.get(def.tag).observedAttributes.sort(), ['count', 'label']);
  });
});

test('a change writes through the bindings, and binds only once', async () => {
  // The property worth having. A light element does not own its children, so an
  // update writes to the nodes it already found and never rebuilds them.
  await withDom(async ({ defineLight }, registry) => {
    const node = { data: '0' };
    let binds = 0;
    const written = [];

    const def = defOf({
      light: true,
      propDefs: { count: 0 },
      bind: (root) => (binds++, [node]),
      update: (b, d) => (written.push(d.count), (b[0].data = String(d.count)), true),
      members: { connected() {} },
    });
    defineLight(def);

    const el = new (registry.get(def.tag))();
    el.isConnected = true;
    el.connectedCallback();

    el.setAttribute('count', '7');
    await el.updateComplete;

    assert.equal(node.data, '7', 'the node it bound was not written');
    // The fake def's coerce passes strings through; the compiled one types them.
    assert.deepEqual(written, ['7'], 'update ran once');
    assert.equal(binds, 1, 'it re-bound instead of writing through');
  });
});

test('a light element still ships nothing when it has no behavior', async () => {
  // The zero-JS default. Reactivity is what a defined element gets, and an
  // element with nothing to define is still not defined.
  await withDom(async ({ defineLight }, registry) => {
    const def = defOf({ light: true, propDefs: { count: 0 }, members: {} });
    defineLight(def);

    assert.equal(registry.get(def.tag), undefined);
  });
});

test('state schedules an update in a light element', async () => {
  // State is not an attribute, so nothing observes it. Its setter is what
  // schedules the write, the same as it is behind a boundary.
  await withDom(async ({ defineLight }, registry) => {
    const node = { data: '0' };
    let binds = 0;

    const def = defOf({
      light: true,
      stateDefs: { n: 0 },
      bind: () => (binds++, [node]),
      update: (b, d) => ((b[0].data = String(d.n)), true),
    });
    defineLight(def, () => {});

    const el = new (registry.get(def.tag))();
    el.isConnected = true;
    el.connectedCallback();

    el.n = 3;
    await el.updateComplete;

    assert.equal(el.n, 3, 'the accessor did not hold the value');
    assert.equal(node.data, '3', 'the node it bound was not written');
    assert.equal(binds, 1, 'it re-bound instead of writing through');
  });
});

test('setting state to the value it already has writes nothing', async () => {
  await withDom(async ({ defineLight }, registry) => {
    let updates = 0;
    const def = defOf({
      light: true,
      stateDefs: { n: 0 },
      bind: () => [{}],
      update: () => (updates++, true),
    });
    defineLight(def, () => {});

    const el = new (registry.get(def.tag))();
    el.isConnected = true;
    el.connectedCallback();

    el.n = 0;
    await el.updateComplete;

    assert.equal(updates, 0);
  });
});

test('state alone is enough to define a light element', async () => {
  // Without this the accessors never exist, so `el.n = 1` is a silent no-op.
  await withDom(async ({ defineLight }, registry) => {
    const def = defOf({ light: true, stateDefs: { n: 0 }, members: {} });
    defineLight(def);

    assert.ok(registry.get(def.tag), 'an element with state was not registered');
  });
});

// ---- state on the server --------------------------------------------------

test('a state default renders on the server, in every shape', async () => {
  // It did not. `render` was called with the coerced props alone, so a template
  // naming state wrote `undefined` into the page and the browser only put the
  // real value there once the element connected.
  const { shadow, fragment, data } = await import('../src/runtime/index.js');
  const def = { css: '', stateDefs: { n: 7 }, coerce: (p) => ({ ...p }), render: (d) => `<p>${d.n}</p>` };

  assert.match(shadow(def, {}), /<p>7<\/p>/);
  assert.match(fragment(def, {}), /<p>7<\/p>/);
  assert.deepEqual(data(def, {}), { n: 7 });
});

test('a prop wins over a state default of the same name', async () => {
  // The order the live element uses. Reversing it here would make the first
  // paint disagree with every one after it.
  const { data } = await import('../src/runtime/index.js');
  const def = { stateDefs: { n: 7 }, coerce: (p) => ({ ...p }) };

  assert.deepEqual(data(def, { n: 1 }), { n: 1 });
});

// ---- what the two element classes share ------------------------------------

/** The body of the `class … extends HTMLElement` inside a named function. */
function classBody(source, after) {
  const from = source.indexOf(after);
  const open = source.indexOf('{', source.indexOf('extends HTMLElement', from));
  let depth = 0;

  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

/** Each method of a class body, by name, as text. */
function methodsOfClass(body) {
  const found = new Map();

  for (const match of body.matchAll(/^ {4}(?:get |set |static )?(#?\w+)\s*\([^)]*\)\s*\{/gm)) {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < body.length; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') {
        depth--;
        if (depth === 0) {
          found.set(match[1], body.slice(match.index, i + 1));
          break;
        }
      }
    }
  }
  return found;
}

/** Comments and spacing are not the behavior. */
const codeOnly = (text) =>
  text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();

test('the light and shadow elements agree on everything but painting', async () => {
  // The two classes are separate on purpose. Sharing a base class would put
  // indirection into the one file that ships to a browser, and the halves
  // differ where it matters. What they must not do is drift on the parts that
  // are the same, so those are compared rather than merged.
  //
  // `connectedCallback` and `#apply` are the two that differ, and they are the
  // whole difference between the halves: a light element writes into the nodes
  // that are already there, and a shadow one may rebuild.
  const file = new URL('../src/runtime/index.js', import.meta.url);
  const source = await fs.promises.readFile(file, 'utf8');

  const light = methodsOfClass(classBody(source, 'export function defineLight'));
  const shadow = methodsOfClass(classBody(source, 'export function defineComponent'));
  assert.ok(light.size >= 10 && shadow.size >= 10, 'both classes were found and parsed');

  const shared = [...light.keys()].filter((name) => shadow.has(name));
  const differ = shared.filter((name) => codeOnly(light.get(name)) !== codeOnly(shadow.get(name)));

  assert.deepEqual(differ.sort(), ['#apply', 'connectedCallback']);
});
