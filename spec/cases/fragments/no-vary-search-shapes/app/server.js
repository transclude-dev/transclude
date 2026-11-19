export default (app) => {
  app.use('*', async (c, next) => {
    await next();
    const value = c.req.header('x-no-vary-search');
    if (value !== undefined) c.header('No-Vary-Search', value);
  });
};
