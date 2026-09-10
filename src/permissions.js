// What a page says it will never ask for.
//
// A `Permissions-Policy` names what a document may reach, and what the frames
// inside it may reach. A page here ships no script by default, so the answer for
// most of them is nobody. Writing that down costs one header and takes nothing
// away.
//
// Off unless the config says otherwise, which is the rule `server.js` states for
// every header with a judgment in it. Refusing the camera is a judgment, and an
// app that wants one has to be able to say so. The generated project turns this
// on, because that is where the author can read the key and change it.
//
// No `node:` imports. This builds a string, and every runtime sends it.

/**
 * The features off when the config says `true`.
 *
 * Every one is a device, a location, a recording or a guess about the reader,
 * and rendering a document asks for none of them. What is left out took longer
 * to decide than what is here. `fullscreen` and `publickey-credentials-get`
 * already default to the page's own origin, so naming them would restate the
 * browser, and getting the second one wrong takes a passkey login away.
 *
 * `[]` is nobody, including this page. `['self']` is this page and no frame.
 */
export const PERMISSIONS_DEFAULTS = {
  accelerometer: [],
  'browsing-topics': [],
  camera: [],
  'display-capture': [],
  geolocation: [],
  gyroscope: [],
  magnetometer: [],
  microphone: [],
  midi: [],
  payment: [],
  usb: [],
};

/**
 * The header, or null when there is nothing to send.
 *
 * A name the browser does not know is skipped rather than fatal, which is what
 * makes a list like this safe to grow: a feature named here and unheard of there
 * costs that browser nothing.
 *
 * @param {boolean|{ features?: Record<string, string[]> }|null|undefined} config
 * @returns {{ name: string, value: string }|null}
 */
export function permissionsHeader(config) {
  if (!config) return null;

  const options = config === true ? {} : config;
  const features = options.features ?? PERMISSIONS_DEFAULTS;

  const parts = Object.entries(features).map(([name, origins]) => `${name}=(${origins.join(' ')})`);
  if (!parts.length) return null;

  return { name: 'Permissions-Policy', value: parts.join(', ') };
}
