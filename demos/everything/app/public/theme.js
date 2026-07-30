// Runs in <head>, before the body parses, which is why `<script head>` exists. A
// theme applied later would flash.
document.documentElement.dataset.theme =
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
