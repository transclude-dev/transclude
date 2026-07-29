// Assembles the document around a layout chain.
//
// The chain is outermost layout first, page last. Body markup folds inward-out:
// the page renders, then each layout renders around what it got.

/**
 * Loads a page's chain and renders the document. Layout loaders run outermost
 * first, each receiving what the ones above returned — so this is sequential by
 * necessity, not by omission.
 */
export async function renderRoute(page, ctx, options = {}) {
  const chain = [...page.layouts, page];
  const datas = [];
  let inherited = {};

  for (const mod of chain) {
    const data = await mod.load({ ...ctx, layout: inherited });
    datas.push(data);
    if (mod !== page) inherited = { ...inherited, ...data };
  }

  return renderDocument(chain, datas, options);
}

export function renderDocument(chain, datas, { clientEntry, stylesheet, lang = 'en' } = {}) {
  // Each level renders to a slot map and hands it to the level above, so a page
  // can fill more than one hole in its layout.
  let slots = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    slots = chain[i].render(datas[i], slots);
  }
  const body = slots.default ?? '';

  // The innermost <title> wins outright. Kept as its own render function rather
  // than sliced out of rendered head markup, so this is a compile-time fact.
  let title = '';
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!chain[i].hasTitle) continue;
    title = chain[i].renderTitle(datas[i]);
    break;
  }

  // Everything else accumulates outermost first, so a page's <meta> comes last
  // and a page's <style> can override a layout's.
  const head = chain.map((mod, i) => mod.renderHead(datas[i])).filter(Boolean);

  // Ahead of the stylesheet, because a <link> blocks the scripts after it and
  // the point of a head script is to run before anything else.
  const headScripts = chain.map((mod) => mod.headScript).filter(Boolean);
  // Partial styles are @scope-d and belong in <head> exactly once, however many
  // times the partial was rendered.
  // A light element's styles are @scope-d and belong in <head> exactly once,
  // however many times it was rendered. A shadow one carries its own.
  const seen = new Set();
  const scoped = [];
  const collect = (defs) => {
    for (const def of defs ?? []) {
      if (seen.has(def.tag)) continue;
      seen.add(def.tag);
      if (def.light && def.css) scoped.push(def.css);
      collect(def.elements);
    }
  };
  for (const mod of chain) collect(mod.elements);

  const css = [...scoped, ...chain.map((mod) => mod.css)].filter(Boolean);

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${title}
${headScripts.join('\n')}
${stylesheet ? `<link rel="stylesheet" href="${stylesheet}">` : ''}
${head.join('\n')}
${css.length ? `<style>\n${css.join('\n')}\n</style>` : ''}
</head>
<body>
${body}
${clientEntry ? `<script type="module" src="${clientEntry}"></script>` : ''}
</body>
</html>
`;
}
