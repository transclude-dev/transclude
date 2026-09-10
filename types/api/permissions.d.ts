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
export declare const PERMISSIONS_DEFAULTS: {
    accelerometer: undefined[];
    'browsing-topics': undefined[];
    camera: undefined[];
    'display-capture': undefined[];
    geolocation: undefined[];
    gyroscope: undefined[];
    magnetometer: undefined[];
    microphone: undefined[];
    midi: undefined[];
    payment: undefined[];
    usb: undefined[];
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
export declare function permissionsHeader(config: boolean | {
    features?: Record<string, string[]>;
} | null | undefined): {
    name: string;
    value: string;
} | null;
