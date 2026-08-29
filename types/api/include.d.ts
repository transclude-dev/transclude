/**
 * `{ resolve, route }` for `renderRoute`.
 *
 * `resolve` reads another site and needs `proxy.allow`; without it an external
 * include says so. `route` reads another route of this app and needs nothing,
 * because nothing leaves the server.
 *
 * @param routes  the route table, as `{ id, pattern }`
 * @param pageFor a route id to its compiled module, possibly a promise
 */
export declare function includeContext({ config, routes, pageFor, lookup }: {
    config: any;
    lookup?: any;
    pageFor: any;
    routes?: any[];
}): {
    resolve: (url: string, id: string) => Promise<string>;
    route: (path: any, id: any, ctx: any, options: any) => Promise<any>;
};
