import path from 'node:path';

// Enough Markdown for this case, and no more: the parser is the app's. The
// loader block passes through whole. After it, a block that starts with `<`
// passes through raw, `# ` is a heading, and any other block is a paragraph.
function convert(source) {
  const end = source.indexOf('</script>') + '</script>'.length;
  const loader = source.startsWith('<script') ? source.slice(0, end) : '';
  const blocks = source.slice(loader.length).split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const body = blocks.map((block) => {
    if (block.startsWith('<')) return block;
    if (block.startsWith('# ')) return `<h1>${block.slice(2)}</h1>`;
    return `<p>${block}</p>`;
  });
  return [loader, ...body].join('\n\n');
}

// The file arrives absolute. Made relative to the project, which is where the
// build runs, so the page reads the same on every machine.
export default {
  markdown: (source, file) => `${convert(source)}\n\n<p id="file">${path.relative(process.cwd(), file)}</p>`,
};
