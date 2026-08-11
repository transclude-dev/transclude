// Markdown pages, and one HTML page beside them in the same tree.

import { markdown } from './app/lib/markdown.js';

export default {
  appDir: 'app',
  port: 1970,
  stylesheet: 'app/styles/global.css',

  // What makes a `.md` file under `routes/` a page. It takes the source and the
  // path, and returns HTML. Without it a `.md` page is an error naming the file,
  // because this package ships no parser and will not guess a flavor.
  markdown,
};
