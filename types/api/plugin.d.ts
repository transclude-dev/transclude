export default function transclude({ appDir, elementsDir, routesDir, publicDir, fragmentParam, watchElements, markdown, }?: {
    appDir?: string;
    elementsDir?: string;
    fragmentParam?: string;
    markdown?: any;
    publicDir?: string;
    routesDir?: string;
    watchElements?: boolean;
}): {
    name: string;
    enforce: string;
    api: {
        manifest(): {
            routes: {
                id: any;
                pattern: any;
                rel: any;
                params: any;
                client: {
                    tags: any[];
                    hasScript: boolean;
                    needed: boolean;
                };
            }[];
            endpoints: {
                id: any;
                pattern: any;
                rel: any;
                params: any;
            }[];
            notFound: {
                id: any;
                rel: any;
                params: any[];
                client: {
                    tags: any[];
                    hasScript: boolean;
                    needed: boolean;
                };
            };
            error: {
                id: any;
                rel: any;
                params: any[];
                client: {
                    tags: any[];
                    hasScript: boolean;
                    needed: boolean;
                };
            };
        };
        configure(config: any): void;
    };
    configResolved(config: any): void;
    resolveId(id: any, importer: any): any;
    load(id: any): string | {
        code: string;
        map: string;
    } | {
        code: string;
        map: object;
    };
    configureServer(server: any): void;
};
/**
 * Browser URL for a virtual module id.
 *
 * No `__x00__`, because the ids carry no '\0' prefix. That encoding is Vite's
 * spelling of the prefix in a URL, and with it here the browser asked for a
 * module the graph no longer holds, on every page that ships JS, in dev only.
 *
 * @param {string} page the route id
 * @returns {string} the URL Vite serves its entry from
 */
export declare function clientEntryUrl(page: string): string;
/**
 * @param {string} page
 * @returns {string} the virtual module id for that page
 */
export declare function pageModuleId(page: string): string;
