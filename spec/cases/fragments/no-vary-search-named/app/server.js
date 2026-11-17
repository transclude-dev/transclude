export default (app) => {
  app.use('*', async (c, next) => {
    await next();
    // Named, not `except=()`. The campaign tags are noise; `fragment` is not.
    c.header('No-Vary-Search', 'params=("utm_source" "utm_medium" "gclid")');
  });
};
