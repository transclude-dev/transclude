export declare const port: number;
export declare const noBuild: boolean;
export declare const app: import("hono").Hono<any, any, "/">;
/**
 * What a freshly started server prints. Kept here rather than in an adapter so
 * three of them do not each grow their own copy of it.
 *
 * @param {number} port
 * @returns {void}
 */
export declare function summary(port: number): void;
