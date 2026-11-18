// app/server.js
export default (app) => {
  app.use('*', async (c, next) => {
    c.header('X-Frame-Options', 'DENY');
    await next();
  });
};
