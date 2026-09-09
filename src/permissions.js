// What a page says it will never ask for.
//
// A `Permissions-Policy` names the powerful features a document, and anything it
// frames, is allowed to reach. A page here ships no script by default, so the
// honest answer for most of them is nobody, and saying so costs a byte count
// rather than a behavior.
//
// Off unless the config says otherwise, which is the rule `server.js` states for
// every header with a judgment in it. Refusing the camera is a judgment: an app
// that wants one has to be able to say so. The generated project turns this on,
// because that is where the author can read the key and change it.
//
// No `node:` imports. This builds a string, and every runtime sends it.

/**
 * The features off when the config says `true`.
 *
 * Each is a sensor, a capture surface or an inference, and a document reaches
 * for none of them by rendering. What is missing is as deliberate as what is
 * here: `fullscreen` and `publickey-credentials-get` already default to the
 * page's own origin, so listing them would restate the browser's answer, and
 * getting one of them wrong would take a passkey login away.
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
