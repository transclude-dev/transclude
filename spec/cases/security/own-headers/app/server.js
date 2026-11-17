export default (app) => {
  app.use('*', async (c, next) => {
    await next();
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Referrer-Policy', 'no-referrer');
  });
};
