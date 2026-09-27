// Deno adapter. `deno run -A framework/bin/serve.deno.js`
//
// A binary from `deno compile` is started outside the project it carries, so it
// looks from here instead: up out of `node_modules` to the app. The import comes
// after, because `production.js` finds the project the moment it loads.
if (Deno.build.standalone && !Deno.env.get('TRANSCLUDE_ROOT')) {
  Deno.env.set('TRANSCLUDE_ROOT', import.meta.dirname);
}
const { app, noBuild, port, summary } = await import('../src/production.js');

if (noBuild) {
  console.error('No build found. Run `npm run build` first.');
  Deno.exit(1);
}

// `Deno.serve` takes the same (Request) => Response the other two do.
Deno.serve({ port, onListen: () => summary(port) }, app.fetch);
