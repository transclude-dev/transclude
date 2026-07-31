// Which port an app listens on. One answer for dev and for production, so an
// app has one port rather than two to remember.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PORT, portOf } from '../src/project.js';

test('an app with no port in its config gets the default', () => {
  assert.equal(portOf({}), DEFAULT_PORT);
  assert.equal(portOf(), DEFAULT_PORT);
});

test('the config names it', () => {
  assert.equal(portOf({ port: 1961 }), 1961);
});

test('PORT beats the config, so a host that assigns one is obeyed', () => {
  // Every platform that runs this hands the port over in the environment. A
  // config that won would make the app unhostable without an edit.
  assert.equal(portOf({ port: 1961 }, '8080'), 8080);
});

test('an empty PORT is not a port', () => {
  // `PORT=` in a .env file reads as an empty string, and `Number('')` is 0,
  // which binds to whatever the OS feels like handing out.
  assert.throws(() => portOf({ port: 1961 }, ''), /whole number/);
});

test('a port that is not a whole number in range is refused', () => {
  for (const bad of ['nope', 0, -1, 65536, 1.5]) {
    assert.throws(() => portOf({ port: bad }), /whole number/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('null reads as unset, not as a bad port', () => {
  assert.equal(portOf({ port: null }), DEFAULT_PORT);
});
