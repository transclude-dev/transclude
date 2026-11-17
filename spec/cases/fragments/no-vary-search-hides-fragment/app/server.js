export default (app) => {
  app.use('*', async (c, next) => {
    await next();
    c.header('No-Vary-Search', 'except=()');
  });
};
